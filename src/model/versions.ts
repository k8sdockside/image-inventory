// Version tags, compared: which of a repository's tags is a newer version of
// the one a pod runs.
//
// A registry lists tags in no useful order, and a tag is only a name --
// `1.27.3`, `1.27.3-alpine3.20`, `v2.1.0`, `7.2.4-debian-12-r5`, `20240101`,
// `latest`, `sha-1a2b3c` -- so a tag is read as a version only when it looks
// like one:
//
//     [v|V]  1 to 4 dot-separated numbers  [ - + or _  and anything after it ]
//
// and another tag is a candidate to replace it only when it has the same
// *shape*: the same prefix, as many numbers, and the same suffix once every run
// of digits in it is taken as a placeholder. `1.27.3-alpine3.20` can become
// `1.27.4-alpine3.21`, but not `1.27.4` or `1.27.4-alpine`: another flavour of
// an image is not an update of it.
//
// Pure functions only. See versions.test.ts.

export interface Version {
    /** The tag, as the registry lists it. */
    tag: string;
    /** `v` or `V` when the tag starts with one; `''` when not. */
    prefix: string;
    /** The dotted numbers: `[1, 27, 3]`. One to four of them. */
    parts: number[];
    /** Everything after the numbers, its separator included: `-alpine3.20`; `''` when there is nothing. */
    suffix: string;
    /** The suffix's numbers in order, with a release stage counted as one of them (alpha < beta < pre < rc). */
    numbers: number[];
    /** What another tag has to match to be compared with this one: the prefix, how many parts, the suffix with its numbers blanked. */
    shape: string;
    /** For a pre-release that leads to a plain release (`2.0.0-rc.1` to `2.0.0`), that release's shape; `''` otherwise. */
    releaseShape: string;
    /** Not a release: `-rc.1`, `-beta2`, `-SNAPSHOT`, `-debug`, … */
    prerelease: boolean;
}

// Fifteen digits at most, so every part is an exact number; a longer run is a
// hash or a timestamp, not a version.
const VERSION = /^([vV]?)(\d{1,15}(?:\.\d{1,15}){0,3})(?:([-+_])(.+))?$/;

/** A commit id in a suffix: seven or more hex characters, with both letters and digits (`g` is git describe's). */
const COMMIT = /^g?[0-9a-f]{7,40}$/i;

/**
 * The steps a release goes through, in order. They are one placeholder in a
 * shape, so `2.0.0-beta.2` and `2.0.0-rc.1` are compared -- and the rc wins.
 */
const STAGES: Readonly<Record<string, number>> = { alpha: 1, beta: 2, pre: 3, preview: 3, rc: 4, cr: 4 };

/** Other words that mark a build as not a release. */
const PRERELEASE: ReadonlySet<string> = new Set([
    'prerelease',
    'dev',
    'devel',
    'develop',
    'development',
    'snapshot',
    'nightly',
    'canary',
    'next',
    'edge',
    'unstable',
    'experimental',
    'insider',
    'insiders',
    'milestone',
    'wip',
    'test',
    'testing',
    'debug',
]);

/** Pre-release words that name a flavour of the image rather than a step towards its release: `1.2.3-debug` does not become `1.2.3`. */
const FLAVOURS: ReadonlySet<string> = new Set(['test', 'testing', 'debug']);

/**
 * A first part this big is a date or a build number (`20240101`, `2024.06.1`),
 * not a version. A tag numbered below it is never offered one numbered above:
 * a repository that switched schemes would otherwise always have a "major"
 * update.
 */
const SCHEME_BREAK = 1000;

interface Suffix {
    shape: string;
    numbers: number[];
    prerelease: boolean;
    /** Every word in it is a pre-release step, so it is on its way to a plain release. */
    stepsOnly: boolean;
}

function readSuffix(suffix: string): Suffix {
    const out: Suffix = { shape: '', numbers: [], prerelease: false, stepsOnly: true };
    out.shape = suffix.replace(/[A-Za-z0-9]+/g, (segment) => {
        if (COMMIT.test(segment) && /\d/.test(segment) && /[a-f]/i.test(segment)) {
            // Two builds' commit ids say nothing about which is newer.
            out.stepsOnly = false;
            return '#';
        }
        return segment.replace(/[A-Za-z]+|\d+/g, (run) => {
            if (/^\d/.test(run)) {
                out.numbers.push(Number(run));
                return '0';
            }
            const word = run.toLowerCase();
            const stage = STAGES[word];
            if (stage !== undefined) {
                out.prerelease = true;
                out.numbers.push(stage);
                return '~';
            }
            if (PRERELEASE.has(word)) {
                out.prerelease = true;
                if (FLAVOURS.has(word)) out.stepsOnly = false;
            } else {
                out.stepsOnly = false;
            }
            return run;
        });
    });
    return out;
}

/** The tag as a version, or `null` when it does not read as one (`latest`, `main`, `sha-1a2b3c`, `a1b2c3d`). */
export function parseVersion(tag: string): Version | null {
    const m = VERSION.exec(tag);
    if (!m) return null;
    const prefix = m[1] ?? '';
    const parts = (m[2] ?? '').split('.').map(Number);
    const suffix = m[3] ? m[3] + (m[4] ?? '') : '';
    const s = readSuffix(suffix);
    const base = `${prefix}/${parts.length}/`;
    return {
        tag,
        prefix,
        parts,
        suffix,
        numbers: s.numbers,
        shape: base + s.shape,
        releaseShape: s.prerelease && s.stepsOnly && suffix ? base : '',
        prerelease: s.prerelease,
    };
}

function compareNumbers(a: readonly number[], b: readonly number[]): number {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
        const d = (a[i] ?? 0) - (b[i] ?? 0);
        if (d) return d < 0 ? -1 : 1;
    }
    return 0;
}

/** On the same numbers, a plain release comes after its own pre-releases: `2.0.0` after `2.0.0-rc.2`. */
function releaseLast(a: Version, b: Version): number {
    if (a.prerelease && !b.prerelease && !b.suffix) return -1;
    if (b.prerelease && !a.prerelease && !a.suffix) return 1;
    return 0;
}

/**
 * Negative when `a` is older than `b`, positive when newer, 0 when neither:
 * the parts as numbers, then a release after its pre-releases, then the
 * suffix's numbers (`-r5` before `-r6`, `alpine3.20` before `alpine3.21`).
 * Meaningful for two versions of one shape, or a pre-release and its release.
 */
export function compareVersions(a: Version, b: Version): number {
    return compareNumbers(a.parts, b.parts) || releaseLast(a, b) || compareNumbers(a.numbers, b.numbers);
}

export type UpdateKind = 'major' | 'minor' | 'patch';

export interface Updates {
    /** The newest tag with the same major and minor version -- or the same version, built again (`-r5` to `-r6`). */
    patch: string | null;
    /** The newest tag with the same major version and a newer minor one. */
    minor: string | null;
    /** The newest tag with a newer major version. */
    major: string | null;
    /** The biggest of the three on offer; `null` when there is none. */
    kind: UpdateKind | null;
}

export function noUpdates(): Updates {
    return { patch: null, minor: null, major: null, kind: null };
}

/**
 * How big a step `to` is from `from`. With two parts there is no patch level
 * in the numbers, with one only major; either way a newer suffix on the same
 * numbers is the smallest step there is, a patch.
 */
function stepOf(from: Version, to: Version): UpdateKind {
    if (to.parts[0] !== from.parts[0]) return 'major';
    if (from.parts.length > 1 && to.parts[1] !== from.parts[1]) return 'minor';
    return 'patch';
}

/**
 * A cheap first look -- a version starts with a digit or a `v` -- so most of
 * ten thousand tags cost a character comparison rather than a regex.
 */
function mayBeVersion(tag: string): boolean {
    const c = tag.charCodeAt(0);
    return (c >= 48 && c <= 57) || c === 118 || c === 86;
}

/**
 * The newest patch, minor and major versions among `tags` for a pod running
 * `tag`. Candidates must have the running tag's shape (or, for a pre-release,
 * be the plain release it leads to); pre-releases count only when the running
 * tag is one itself. Nothing is on offer for a tag that is not a version.
 */
export function findUpdates(tag: string, tags: readonly string[]): Updates {
    const out = noUpdates();
    const current = parseVersion(tag);
    if (!current) return out;
    const small = (current.parts[0] ?? 0) < SCHEME_BREAK;
    const best: Partial<Record<UpdateKind, Version>> = {};
    for (const candidate of tags) {
        if (candidate === tag || !mayBeVersion(candidate)) continue;
        const v = parseVersion(candidate);
        if (!v) continue;
        if (v.prerelease && !current.prerelease) continue;
        if (v.shape !== current.shape && v.shape !== current.releaseShape) continue;
        if (small && (v.parts[0] ?? 0) >= SCHEME_BREAK) continue;
        if (compareVersions(v, current) <= 0) continue;
        const kind = stepOf(current, v);
        const have = best[kind];
        if (!have || compareVersions(v, have) > 0) best[kind] = v;
    }
    out.patch = best.patch?.tag ?? null;
    out.minor = best.minor?.tag ?? null;
    out.major = best.major?.tag ?? null;
    out.kind = out.major ? 'major' : out.minor ? 'minor' : out.patch ? 'patch' : null;
    return out;
}

/** Tie-breaks between equally common shapes: three parts reads most like a release, then two, four, one. */
const PARTS_RANK: readonly number[] = [9, 3, 1, 0, 2];

interface ShapeCount {
    key: string;
    count: number;
    newest: Version;
}

function preferred(a: ShapeCount, b: ShapeCount): boolean {
    if (a.count !== b.count) return a.count > b.count;
    const plainA = a.newest.suffix ? 1 : 0;
    const plainB = b.newest.suffix ? 1 : 0;
    if (plainA !== plainB) return plainA < plainB;
    const partsA = PARTS_RANK[a.newest.parts.length] ?? 9;
    const partsB = PARTS_RANK[b.newest.parts.length] ?? 9;
    if (partsA !== partsB) return partsA < partsB;
    return a.key < b.key;
}

/**
 * The newest release among `tags`, for a pod running a tag that is not a
 * version -- `latest`, `main`, `stable` -- to say what that stands for now.
 * Taken from the most common shape the repository's releases have (a plain
 * `1.29.1` rather than `1.29.1-alpine-perl` when there are as many of each),
 * with date-numbered tags counted apart from versions of the same shape.
 * `null` when the repository has no release tags at all.
 */
export function newestVersion(tags: readonly string[]): string | null {
    const shapes = new Map<string, ShapeCount>();
    for (const tag of tags) {
        if (!mayBeVersion(tag)) continue;
        const v = parseVersion(tag);
        if (!v || v.prerelease) continue;
        const key = (v.parts[0] ?? 0) >= SCHEME_BREAK ? v.shape + '/dated' : v.shape;
        const have = shapes.get(key);
        if (!have) shapes.set(key, { key, count: 1, newest: v });
        else {
            have.count++;
            if (compareVersions(v, have.newest) > 0) have.newest = v;
        }
    }
    let pick: ShapeCount | undefined;
    for (const s of shapes.values()) if (!pick || preferred(s, pick)) pick = s;
    return pick?.newest.tag ?? null;
}
