import { describe, expect, it } from 'vitest';
import { compareVersions, findUpdates, newestVersion, parseVersion, type Updates, type Version } from './versions';

function v(tag: string): Version {
    const out = parseVersion(tag);
    if (!out) throw new Error(`${tag} does not parse`);
    return out;
}

describe('parseVersion', () => {
    const cases: [string, Partial<Version>][] = [
        ['1.27.3', { prefix: '', parts: [1, 27, 3], suffix: '', numbers: [], prerelease: false, shape: '/3/' }],
        ['v1.8.1', { prefix: 'v', parts: [1, 8, 1], shape: 'v/3/' }],
        ['V2.0', { prefix: 'V', parts: [2, 0], shape: 'V/2/' }],
        ['16.4', { parts: [16, 4], shape: '/2/' }],
        ['3', { parts: [3], shape: '/1/' }],
        ['20240101', { parts: [20240101], shape: '/1/' }],
        ['1.2.3.4', { parts: [1, 2, 3, 4], shape: '/4/' }],
        ['01.002.3', { parts: [1, 2, 3] }],
        ['1.27.3-alpine3.20', { suffix: '-alpine3.20', numbers: [3, 20], shape: '/3/-alpine0.0', prerelease: false }],
        ['1.27-alpine', { parts: [1, 27], suffix: '-alpine', numbers: [], shape: '/2/-alpine' }],
        ['7.2.4-debian-12-r5', { suffix: '-debian-12-r5', numbers: [12, 5], shape: '/3/-debian-0-r0', prerelease: false }],
        ['1.2.3-1', { numbers: [1], shape: '/3/-0' }],
        ['1.2.3+build.5', { suffix: '+build.5', numbers: [5], shape: '/3/+build.0' }],
        ['1.2.3_linux', { suffix: '_linux', shape: '/3/_linux' }],
        ['2024-06-01', { parts: [2024], numbers: [6, 1], shape: '/1/-0-0' }],
        // Pre-releases, and the release each one leads to.
        ['2.0.0-rc.1', { prerelease: true, numbers: [4, 1], shape: '/3/-~.0', releaseShape: '/3/' }],
        ['1.0.0-beta2', { prerelease: true, numbers: [2, 2], shape: '/3/-~0', releaseShape: '/3/' }],
        ['1.0.0-alpha', { prerelease: true, numbers: [1], shape: '/3/-~' }],
        ['v3.1.0-RC1', { prerelease: true, numbers: [4, 1], shape: 'v/3/-~0', releaseShape: 'v/3/' }],
        ['3.1.0-SNAPSHOT', { prerelease: true, shape: '/3/-SNAPSHOT', releaseShape: '/3/' }],
        ['1.2.3-dev.20240101', { prerelease: true, releaseShape: '/3/' }],
        ['1.2.3-nightly', { prerelease: true }],
        ['1.2.3-preview.4', { prerelease: true, numbers: [3, 4] }],
        ['1.2.3-debug', { prerelease: true, releaseShape: '' }],
        ['1.2.3-rc1-alpine', { prerelease: true, releaseShape: '' }],
        // Words that only contain a pre-release word are not one.
        ['1.2.3-debian', { prerelease: false }],
        ['1.2.3-latest', { prerelease: false }],
        ['1.2.3-bookworm', { prerelease: false }],
        ['1.2.3-r0', { prerelease: false, numbers: [0] }],
        // A commit id is a placeholder of its own, with no numbers to compare.
        ['1.2.3-abc1234f', { shape: '/3/-#', numbers: [] }],
        ['v0.9.0-12-g1a2b3c4d', { shape: 'v/3/-0-#', numbers: [12] }],
    ];
    for (const [tag, want] of cases) {
        it(`reads ${tag}`, () => {
            expect(parseVersion(tag)).toMatchObject({ tag, ...want });
        });
    }

    const notVersions = ['latest', 'main', 'stable', 'stable-alpine', 'alpine', 'sha-1a2b3c', 'a1b2c3d', '1a2b3c4d', 'deadbeef', '', 'v', '1.', '.1', '1..2', '1.2-', '1.2.3.4.5', '1.2.3alpine', '1234567890123456', 'v1.2.3.4.5-rc'];
    for (const tag of notVersions) {
        it(`does not read ${JSON.stringify(tag)} as a version`, () => {
            expect(parseVersion(tag)).toBeNull();
        });
    }
});

describe('compareVersions', () => {
    const ordered: [string, string][] = [
        ['1.27.3', '1.27.4'],
        ['1.9.0', '1.10.0'],
        ['1.27.3-alpine3.20', '1.27.3-alpine3.21'],
        ['1.27.3-alpine3.21', '1.27.4-alpine3.20'],
        ['7.2.4-debian-12-r5', '7.2.4-debian-12-r6'],
        ['7.2.4-debian-11-r9', '7.2.4-debian-12-r0'],
        ['1.2.3-1', '1.2.3-2'],
        ['2.0.0-alpha.3', '2.0.0-beta.1'],
        ['2.0.0-beta.2', '2.0.0-rc.1'],
        ['2.0.0-rc.2', '2.0.0'],
        ['1.9.9', '2.0.0-rc.1'],
    ];
    for (const [older, newer] of ordered) {
        it(`puts ${older} before ${newer}`, () => {
            expect(compareVersions(v(older), v(newer))).toBe(-1);
            expect(compareVersions(v(newer), v(older))).toBe(1);
        });
    }

    it('treats leading zeros and commit ids as nothing to choose between', () => {
        expect(compareVersions(v('1.02.3'), v('1.2.3'))).toBe(0);
        expect(compareVersions(v('1.2.3-abc1234f'), v('1.2.3-0123abcd'))).toBe(0);
    });
});

describe('findUpdates', () => {
    const none: Updates = { patch: null, minor: null, major: null, kind: null };
    const cases: [string, string, string[], Updates][] = [
        [
            'nginx: newest of each step, in any order, ignoring flavours, pre-releases and floating tags',
            '1.27.3',
            ['1.29.0', '1.27.3', '1.27.5', '2.0.1', '1.27.4', '1.28.0', '1.29.1', '1.27.5-alpine', '1.30.0-rc1', '3.0.0-beta', 'latest', 'mainline', '1.27', '1', 'stable-perl'],
            { patch: '1.27.5', minor: '1.29.1', major: '2.0.1', kind: 'major' },
        ],
        ['nginx: nothing newer', '1.29.1', ['1.27.3', '1.29.0', '1.29.1', '1.29.1-alpine', 'latest'], none],
        [
            'nginx on alpine: only the same flavour, with the base image version compared too',
            '1.27.3-alpine3.20',
            ['1.27.4', '1.27.4-alpine', '1.27.3-alpine3.21', '1.27.4-alpine3.21', '1.28.0-alpine3.21', '1.28.0-alpine3.21-perl', '1.27.2-alpine3.22'],
            { patch: '1.27.4-alpine3.21', minor: '1.28.0-alpine3.21', major: null, kind: 'minor' },
        ],
        [
            'bitnami: the revision is part of the version',
            '7.2.4-debian-12-r5',
            ['7.2.4-debian-12-r4', '7.2.4-debian-12-r6', '7.2.5-debian-12-r0', '7.4.1-debian-12-r3', '8.0.0-debian-12-r1', '7.2.5', '7.4.2-debian-12-r3-arm64', 'latest'],
            { patch: '7.2.5-debian-12-r0', minor: '7.4.1-debian-12-r3', major: '8.0.0-debian-12-r1', kind: 'major' },
        ],
        ['bitnami: only a newer revision is a patch', '7.2.4-debian-12-r5', ['7.2.4-debian-12-r6', '7.2.4-debian-12-r5'], { patch: '7.2.4-debian-12-r6', minor: null, major: null, kind: 'patch' }],
        ['a Debian-style revision', '1.2.3-1', ['1.2.3-2', '1.2.3', '1.2.2-9'], { patch: '1.2.3-2', minor: null, major: null, kind: 'patch' }],
        [
            'v-prefixed: numbers compared as numbers, and the prefix kept',
            'v1.8.1',
            ['v1.8.2', '1.9.0', 'v1.9.0', 'v1.10.0', 'V2.0.0', 'v2.0.0-rc.1', 'v1.8.2-rc.1'],
            { patch: 'v1.8.2', minor: 'v1.10.0', major: null, kind: 'minor' },
        ],
        ['two parts: no patch level', '16.4', ['16.5', '16.6', '16.4.1', '17.0', '17.2', '17'], { patch: null, minor: '16.6', major: '17.2', kind: 'major' }],
        ['two parts with a flavour', '16.4-alpine', ['16.6-alpine', '17.2-alpine3.20', '16.6'], { patch: null, minor: '16.6-alpine', major: null, kind: 'minor' }],
        ['two parts, rebuilt base', '3.20-alpine3.19', ['3.20-alpine3.20'], { patch: '3.20-alpine3.20', minor: null, major: null, kind: 'patch' }],
        ['one part: only major', '3', ['4', '5', '3.1', '3-alpine'], { patch: null, minor: null, major: '5', kind: 'major' }],
        ['a date', '20240101', ['20240915', '20231231', '1.2.3', '20240101'], { patch: null, minor: null, major: '20240915', kind: 'major' }],
        ['a dotted date', '2024.06.1', ['2024.06.2', '2024.07.0', '2025.01.0'], { patch: '2024.06.2', minor: '2024.07.0', major: '2025.01.0', kind: 'major' }],
        ['pre-releases are not offered to a release', '1.2.3', ['1.2.4-rc1', '1.3.0-beta.1', '2.0.0-alpha', '1.2.4-SNAPSHOT', '1.2.4-dev'], none],
        [
            'a pre-release is offered newer pre-releases, and its release',
            '2.0.0-rc.1',
            ['2.0.0-beta.3', '2.0.0-rc.2', '2.0.0', '2.1.0-beta.1', '1.9.9', '3.0.0-alpha.1', '2.0.0-alpine'],
            { patch: '2.0.0', minor: '2.1.0-beta.1', major: '3.0.0-alpha.1', kind: 'major' },
        ],
        ['a debug flavour is not on its way to a release', '1.2.3-debug', ['1.2.3', '1.2.4', '1.2.4-debug'], { patch: '1.2.4-debug', minor: null, major: null, kind: 'patch' }],
        ['mixed schemes: a version is never offered a date', '1.25.3', ['2024.1.1', '1.25.4', '20240101', '1000.0.0'], { patch: '1.25.4', minor: null, major: null, kind: 'patch' }],
        ['mixed schemes: a single number either', '3', ['20240101', '4'], { patch: null, minor: null, major: '4', kind: 'major' }],
        ['commit ids: only the numbers count', '1.2.3-abc1234f', ['1.2.4-def5678a', '1.2.3-0123abcd'], { patch: '1.2.4-def5678a', minor: null, major: null, kind: 'patch' }],
        ['a tag that is not a version has no updates', 'latest', ['1.0.0', '2.0.0'], none],
        ['nor does a commit tag', 'sha-1a2b3c4', ['sha-9f9f9f9', '1.0.0'], none],
        ['nothing listed', '1.0.0', [], none],
    ];
    for (const [name, tag, tags, want] of cases) {
        it(name, () => {
            expect(findUpdates(tag, tags)).toEqual(want);
            expect(findUpdates(tag, [...tags].reverse())).toEqual(want);
        });
    }

    it('stays fast for ten thousand tags', () => {
        const tags: string[] = [];
        for (let major = 0; tags.length < 10_000; major++) {
            for (let minor = 0; minor < 20; minor++) {
                for (let patch = 0; patch < 5; patch++) {
                    tags.push(`${major}.${minor}.${patch}`, `${major}.${minor}.${patch}-alpine3.${minor}`, `sha-${(major * 1000 + minor * 10 + patch).toString(16).padStart(7, '0')}a`);
                }
            }
        }
        const started = performance.now();
        const got = findUpdates('1.2.3-alpine3.2', tags);
        const newest = newestVersion(tags);
        const took = performance.now() - started;
        expect(got.kind).toBe('major');
        expect(newest).not.toBeNull();
        expect(took).toBeLessThan(500);
    });
});

describe('newestVersion', () => {
    const cases: [string, string[], string | null][] = [
        ['nginx: the plain release', ['latest', '1.29.1', '1.29.1-alpine', '1.28.0', '1.29.0', '1.30.0-rc1', 'mainline', '1.29', '1', 'stable-alpine', '1.29.1-perl', '1.28.0-alpine'], '1.29.1'],
        ['only flavoured releases', ['3.20-alpine', '3.21-alpine', 'edge'], '3.21-alpine'],
        ['v-prefixed', ['v1.2.0', 'v1.10.0', 'v1.9.3', 'main', 'sha-abc1234'], 'v1.10.0'],
        ['equally many plain and flavoured', ['1.0.0-amd64', '1.0.0', '1.1.0-amd64', '1.1.0'], '1.1.0'],
        ['dated tags counted apart', ['1.2.3', '1.2.4', '2024.01.01'], '1.2.4'],
        ['a repository that only dates its tags', ['20240101', '20240915', 'latest'], '20240915'],
        ['pre-releases are not releases', ['2.0.0-rc1', 'latest'], null],
        ['no version at all', ['latest', 'main', 'sha-1a2b3c4'], null],
        ['nothing listed', [], null],
    ];
    for (const [name, tags, want] of cases) {
        it(name, () => {
            expect(newestVersion(tags)).toBe(want);
            expect(newestVersion([...tags].reverse())).toBe(want);
        });
    }
});
