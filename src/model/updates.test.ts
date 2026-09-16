import { describe, expect, it } from 'vitest';
import { parseImageRef, repositoryKey } from './image-ref';
import { buildInventory, type ClusterData } from './inventory';
import type { Container, ContainerStatus, Pod, Workload } from './kube';
import { buildUpdates, failureText, hasUpdate, refusedLookup, STATE_ORDER, tagsPage, updateRow, type UpdateReport, type UpdateRow } from './updates';

const OLD = 'sha256:' + '1'.repeat(64);
const NEW = 'sha256:' + '2'.repeat(64);
const OTHER = 'sha256:' + '3'.repeat(64);

let uid = 0;

function deployment(ns: string, name: string, image: string): Workload {
    return { metadata: { name, namespace: ns, uid: `uid-${name}` }, spec: { template: { spec: { containers: [{ name: 'app', image }] } } } };
}

/** A running pod of a Deployment, one container, which pulled `digest`. */
function pod(ns: string, deploymentName: string, image: string, digest: string, o: { phase?: string; status?: Partial<ContainerStatus> } = {}): Pod {
    uid++;
    const hash = 'abc12';
    const containers: Container[] = [{ name: 'app', image }];
    return {
        metadata: {
            name: `${deploymentName}-${hash}-${uid}`,
            namespace: ns,
            uid: `pod-${uid}`,
            labels: { 'pod-template-hash': hash },
            ownerReferences: [{ apiVersion: 'apps/v1', kind: 'ReplicaSet', name: `${deploymentName}-${hash}`, uid: 'rs', controller: true }],
        },
        spec: { containers, nodeName: 'node-1' },
        status: {
            phase: o.phase ?? 'Running',
            containerStatuses: [{ name: 'app', ready: true, restartCount: 0, state: { running: {} }, imageID: digest ? `${repositoryKey(parseImageRef(image))}@${digest}` : '', ...o.status }],
        },
    };
}

function answer(image: string, tags: string[], digest = '', extra: Partial<K8sDockside.RegistryLookup> = {}): K8sDockside.RegistryLookup {
    const ref = parseImageRef(image);
    return {
        image,
        registry: ref.registry,
        repository: ref.repository,
        tag: ref.tag || (ref.digest ? '' : 'latest'),
        tags,
        truncated: false,
        digest,
        checkedAt: '2026-09-16T10:00:00Z',
        status: 'ok',
        error: '',
        ...extra,
    };
}

function cluster(): ClusterData {
    return {
        deployments: [
            deployment('shop', 'web', 'nginx:1.27.3'),
            deployment('shop', 'cache', 'bitnami/redis:7.2.4-debian-12-r5'),
            deployment('shop', 'cart', 'acme/cart:latest'),
            deployment('shop', 'api', 'ghcr.io/acme/api:v2.1.0'),
            deployment('ops', 'grafana', 'grafana/grafana:11.2.0'),
            deployment('ops', 'agent', 'quay.io/acme/agent:main'),
            deployment('ops', 'pinned', `quay.io/acme/pinned@${OLD}`),
            deployment('ops', 'private', 'registry.example.com/team/app:1.0.0'),
            deployment('tools', 'idle', 'busybox:1.36'),
        ],
        pods: [
            pod('shop', 'web', 'nginx:1.27.3', OLD),
            pod('shop', 'web', 'nginx:1.27.3', OLD),
            pod('shop', 'web', 'nginx:1.27.3', OLD),
            pod('shop', 'cache', 'bitnami/redis:7.2.4-debian-12-r5', OLD),
            pod('shop', 'cart', 'acme/cart:latest', OLD),
            pod('shop', 'cart', 'acme/cart:latest', NEW),
            pod('shop', 'api', 'ghcr.io/acme/api:v2.1.0', NEW),
            pod('ops', 'grafana', 'grafana/grafana:11.2.0', OLD),
            pod('ops', 'agent', 'quay.io/acme/agent:main', ''),
            pod('ops', 'pinned', `quay.io/acme/pinned@${OLD}`, OLD),
            pod('ops', 'private', 'registry.example.com/team/app:1.0.0', OLD),
            // A finished pod's image is not running: no row for it.
            pod('batch', 'report', 'acme/report:3', OLD, { phase: 'Succeeded' }),
        ],
    };
}

function lookups(): Map<string, K8sDockside.RegistryLookup> {
    return new Map([
        ['docker.io/library/nginx:1.27.3', answer('nginx:1.27.3', ['1.27.3', '1.27.4', '1.28.0', '1.29.1', '2.0.1', 'latest'], OLD)],
        ['docker.io/bitnami/redis:7.2.4-debian-12-r5', answer('bitnami/redis:7.2.4-debian-12-r5', ['7.2.4-debian-12-r5', '7.2.4-debian-12-r6'], NEW)],
        ['docker.io/acme/cart:latest', answer('acme/cart:latest', ['latest', '1.0.0', '1.1.0', '1.1.0-alpine'], NEW)],
        ['ghcr.io/acme/api:v2.1.0', answer('ghcr.io/acme/api:v2.1.0', ['v2.0.0', 'v2.1.0'], NEW, { truncated: true })],
        ['docker.io/grafana/grafana:11.2.0', answer('grafana/grafana:11.2.0', ['11.2.0'], NEW)],
        ['quay.io/acme/agent:main', answer('quay.io/acme/agent:main', ['main', 'sha-1a2b3c4'], NEW)],
        ['registry.example.com/team/app:1.0.0', answer('registry.example.com/team/app:1.0.0', [], '', { status: 'auth', error: '401 Unauthorized' })],
    ]);
}

function row(report: UpdateReport, key: string): UpdateRow {
    const r = report.rows.find((x) => x.key === key);
    if (!r) throw new Error(`no row ${key}; have ${report.rows.map((x) => x.key).join(', ')}`);
    return r;
}

describe('buildUpdates', () => {
    it('has one row per image that runs', () => {
        const report = buildUpdates(buildInventory(cluster()), lookups());
        expect(report.rows.map((r) => r.key).sort()).toEqual([
            'docker.io/acme/cart:latest',
            'docker.io/bitnami/redis:7.2.4-debian-12-r5',
            'docker.io/grafana/grafana:11.2.0',
            'docker.io/library/nginx:1.27.3',
            'ghcr.io/acme/api:v2.1.0',
            'quay.io/acme/agent:main',
            `quay.io/acme/pinned@${OLD}`,
            'registry.example.com/team/app:1.0.0',
        ]);
    });

    it('offers a version tag its newest patch, minor and major', () => {
        const nginx = row(buildUpdates(buildInventory(cluster()), lookups()), 'docker.io/library/nginx:1.27.3');
        expect(nginx).toMatchObject({
            state: 'major',
            tag: '1.27.3',
            ask: 'nginx:1.27.3',
            versioned: true,
            updates: { patch: '1.27.4', minor: '1.29.1', major: '2.0.1', kind: 'major' },
            repushed: false,
            containers: 3,
            registryLabel: 'Docker Hub',
            namespaces: ['shop'],
        });
        expect(nginx.workloads.map((w) => [w.workload.key, w.running])).toEqual([['Deployment/shop/web', 3]]);
    });

    it('counts a newer revision as a patch, and notices the tag was pushed again', () => {
        const redis = row(buildUpdates(buildInventory(cluster()), lookups()), 'docker.io/bitnami/redis:7.2.4-debian-12-r5');
        expect(redis).toMatchObject({ state: 'patch', repushed: true, behind: 1, staleDigests: [OLD] });
    });

    it('calls a floating tag rebuilt when some pods run an older build, and says what it stands for', () => {
        const cart = row(buildUpdates(buildInventory(cluster()), lookups()), 'docker.io/acme/cart:latest');
        expect(cart).toMatchObject({ state: 'rebuilt', versioned: false, newest: '1.1.0', repushed: true, behind: 1, containers: 2 });
    });

    it('calls a version tag with nothing newer but a new build rebuilt', () => {
        const grafana = row(buildUpdates(buildInventory(cluster()), lookups()), 'docker.io/grafana/grafana:11.2.0');
        expect(grafana).toMatchObject({ state: 'rebuilt', updates: { kind: null }, repushed: true });
    });

    it('calls a version tag with nothing newer and the same build current, and says the list was cut short', () => {
        const api = row(buildUpdates(buildInventory(cluster()), lookups()), 'ghcr.io/acme/api:v2.1.0');
        expect(api).toMatchObject({ state: 'current', repushed: false, registryLabel: 'GitHub' });
        expect(api.note).toBe('Only the first 10000 tags were read, so a newer one may be missing.');
    });

    it('cannot tell for a floating tag with no build to compare', () => {
        const agent = row(buildUpdates(buildInventory(cluster()), lookups()), 'quay.io/acme/agent:main');
        expect(agent).toMatchObject({ state: 'unknown', newest: null });
        expect(agent.note).toBe(':main is not a version, and no pod has reported which build it runs yet.');
    });

    it('does not ask about a reference pinned by a digest alone', () => {
        const pinned = row(buildUpdates(buildInventory(cluster()), lookups()), `quay.io/acme/pinned@${OLD}`);
        expect(pinned).toMatchObject({ state: 'unknown', tag: '', ask: '', lookup: null });
        expect(pinned.note).toMatch(/digest alone/);
    });

    it('keeps why the registry could not be asked', () => {
        const priv = row(buildUpdates(buildInventory(cluster()), lookups()), 'registry.example.com/team/app:1.0.0');
        expect(priv).toMatchObject({ state: 'failed', reason: 'The registry wants credentials; only public images are checked.' });
    });

    it('is pending until an answer comes', () => {
        const report = buildUpdates(buildInventory(cluster()), new Map());
        expect(report.rows.filter((r) => r.state === 'pending')).toHaveLength(7);
        expect(report.summary).toMatchObject({ askable: 7, answered: 0, updates: 0, oldestAnswer: 0, commonFailure: null });
    });

    it('lists the biggest updates first, then the busiest', () => {
        const report = buildUpdates(buildInventory(cluster()), lookups());
        expect(report.rows.map((r) => [r.state, r.key])).toEqual([
            ['major', 'docker.io/library/nginx:1.27.3'],
            ['patch', 'docker.io/bitnami/redis:7.2.4-debian-12-r5'],
            ['rebuilt', 'docker.io/acme/cart:latest'],
            ['rebuilt', 'docker.io/grafana/grafana:11.2.0'],
            ['failed', 'registry.example.com/team/app:1.0.0'],
            ['unknown', 'quay.io/acme/agent:main'],
            ['unknown', `quay.io/acme/pinned@${OLD}`],
            ['current', 'ghcr.io/acme/api:v2.1.0'],
        ]);
    });

    it('sums up what the headline says', () => {
        const s = buildUpdates(buildInventory(cluster()), lookups()).summary;
        expect(s).toMatchObject({
            images: 8,
            counts: { major: 1, minor: 0, patch: 1, rebuilt: 2, current: 1, unknown: 2, failed: 1, pending: 0 },
            updates: 4,
            containers: 7,
            workloads: 4,
            repushed: 3,
            askable: 7,
            answered: 7,
            oldestAnswer: Date.parse('2026-09-16T10:00:00Z'),
            commonFailure: { status: 'auth', gist: 'the registry wants credentials', count: 1 },
        });
    });

    it('names the commonest failure only when it is commoner than the rest', () => {
        const inv = buildInventory(cluster());
        const failed = (status: K8sDockside.RegistryStatus, image: string): K8sDockside.RegistryLookup => answer(image, [], '', { status });
        const answers = new Map([
            ['docker.io/library/nginx:1.27.3', failed('limited', 'nginx:1.27.3')],
            ['docker.io/acme/cart:latest', failed('limited', 'acme/cart:latest')],
            ['registry.example.com/team/app:1.0.0', failed('auth', 'registry.example.com/team/app:1.0.0')],
        ]);
        expect(buildUpdates(inv, answers).summary.commonFailure).toEqual({ status: 'limited', gist: 'the registry is rate-limiting', count: 2 });
        answers.set('ghcr.io/acme/api:v2.1.0', failed('auth', 'ghcr.io/acme/api:v2.1.0'));
        expect(buildUpdates(inv, answers).summary.commonFailure).toBeNull();
        answers.set('quay.io/acme/agent:main', failed('auth', 'quay.io/acme/agent:main'));
        expect(buildUpdates(inv, answers).summary.commonFailure).toMatchObject({ status: 'auth', count: 3 });
    });

    it('has a signature that changes when an answer does', () => {
        const inv = buildInventory(cluster());
        const a = buildUpdates(inv, new Map()).signature;
        expect(buildUpdates(inv, new Map()).signature).toBe(a);
        expect(buildUpdates(inv, lookups()).signature).not.toBe(a);
    });
});

describe('updateRow', () => {
    const inv = buildInventory({ pods: [pod('default', 'web', 'nginx:1.27', OLD), pod('default', 'web', 'nginx:1.27', OTHER)] });
    const entry = inv.images[0]!;

    it('flags a moving version tag as pushed again alongside its update', () => {
        const r = updateRow(entry, answer('nginx:1.27', ['1.27', '1.28', '1.27.5'], NEW));
        expect(r).toMatchObject({ state: 'minor', repushed: true, behind: 2, updates: { minor: '1.28', patch: null } });
        expect(r.staleDigests.sort()).toEqual([OLD, OTHER]);
    });

    it('is current when every pod runs the build the tag points at', () => {
        const same = buildInventory({ pods: [pod('default', 'web', 'nginx', OLD)] }).images[0]!;
        expect(updateRow(same, answer('nginx', ['latest', '1.0.0'], OLD))).toMatchObject({ tag: 'latest', state: 'current', newest: '1.0.0', repushed: false });
    });

    it('cannot tell for a floating tag when the registry names no build', () => {
        const same = buildInventory({ pods: [pod('default', 'web', 'nginx:stable', OLD)] }).images[0]!;
        const r = updateRow(same, answer('nginx:stable', ['stable'], ''));
        expect(r.state).toBe('unknown');
        expect(r.note).toBe(':stable is not a version, and the registry did not say which build it points at.');
    });

    it('leaves out a build the node recorded under another repository', () => {
        // A node holding a mirror's copy of the same build reports the
        // mirror's name and digest for this image too.
        const image = 'registry.k8s.io/sig-storage/csi-attacher:v4.11.0';
        const mirrored = buildInventory({
            pods: [pod('rook', 'csi', image, OLD, { status: { imageID: `docker.io/longhornio/csi-attacher@${OLD}` } })],
        }).images[0]!;
        const r = updateRow(mirrored, answer(image, ['v4.11.0', 'v4.13.0'], NEW));
        expect(r).toMatchObject({ state: 'minor', repushed: false, behind: 0, staleDigests: [] });
    });

    it('is current, not unknown, for a version tag whose build cannot be compared', () => {
        expect(updateRow(entry, answer('nginx:1.27', ['1.27'], '')).state).toBe('current');
    });
});

describe('failureText', () => {
    const cases: [K8sDockside.RegistryStatus, string, string][] = [
        ['ok', '', ''],
        ['auth', '401', 'The registry wants credentials; only public images are checked.'],
        ['limited', '429', 'The registry is rate-limiting; try again later.'],
        ['missing', 'manifest unknown', 'The registry does not know this repository (or this tag).'],
        ['unreachable', 'dial tcp: lookup registry.example.com: no such host', 'Could not reach registry.example.com: dial tcp: lookup registry.example.com: no such host'],
        ['unreachable', '', 'Could not reach registry.example.com.'],
        ['error', 'unexpected media type', 'unexpected media type'],
        ['error', '', 'The registry could not be asked.'],
    ];
    for (const [status, error, want] of cases) {
        it(`words ${status}${error ? ` (${error})` : ''}`, () => {
            expect(failureText({ status, error, registry: 'registry.example.com' })).toBe(want);
        });
    }
});

describe('refusedLookup', () => {
    it('turns a refusal into a failed answer for the row', () => {
        const ref = parseImageRef('ghcr.io/acme/api:v1');
        const a = refusedLookup(ref, 'ghcr.io/acme/api:v1', 'no pod in this cluster runs ghcr.io/acme/api:v1', '2026-09-16T10:00:00Z');
        expect(a).toMatchObject({ status: 'error', registry: 'ghcr.io', repository: 'acme/api', tag: 'v1', tags: [], error: 'no pod in this cluster runs ghcr.io/acme/api:v1' });
        const inv = buildInventory({ pods: [pod('default', 'api', 'ghcr.io/acme/api:v1', OLD)] });
        expect(updateRow(inv.images[0]!, a)).toMatchObject({ state: 'failed', reason: 'no pod in this cluster runs ghcr.io/acme/api:v1' });
    });
});

describe('tagsPage', () => {
    const cases: [string, string | null][] = [
        ['nginx:1.27', 'https://hub.docker.com/_/nginx/tags'],
        ['docker.io/library/redis', 'https://hub.docker.com/_/redis/tags'],
        ['bitnami/redis:7.2', 'https://hub.docker.com/r/bitnami/redis/tags'],
        ['quay.io/prometheus/node-exporter:v1.8.1', 'https://quay.io/repository/prometheus/node-exporter?tab=tags'],
        ['ghcr.io/acme/api:v1', null],
        ['registry.k8s.io/pause:3.9', null],
    ];
    for (const [image, want] of cases) {
        it(`links ${image}`, () => {
            expect(tagsPage(parseImageRef(image))?.url ?? null).toBe(want);
        });
    }
});

describe('states', () => {
    it('lists every state once, updates first', () => {
        expect(new Set(STATE_ORDER).size).toBe(8);
        expect(STATE_ORDER.filter(hasUpdate)).toEqual(['major', 'minor', 'patch', 'rebuilt']);
    });
});
