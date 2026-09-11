import { describe, expect, it } from 'vitest';
import { buildInventory, pullEvents, resolveWorkload, type ClusterData, type ImageEntry } from './inventory';
import type { Container, ContainerStatus, CronJob, Job, KubeEvent, Pod, Workload } from './kube';

const SHA_A = 'sha256:' + 'a'.repeat(64);
const SHA_B = 'sha256:' + 'b'.repeat(64);

let uid = 0;
function owner(kind: string, name: string, ownerUid = `uid-${name}`): K8sDockside.OwnerReference {
    return { apiVersion: 'apps/v1', kind, name, uid: ownerUid, controller: true };
}

function deployment(ns: string, name: string, containers: Container[], init: Container[] = []): Workload {
    return { metadata: { name, namespace: ns, uid: `uid-${name}` }, spec: { selector: { matchLabels: { app: name } }, template: { spec: { containers, initContainers: init } } } };
}

function replicaSet(ns: string, name: string, deploymentName: string): Workload {
    return { metadata: { name, namespace: ns, uid: `uid-${name}`, ownerReferences: [owner('Deployment', deploymentName)] } };
}

interface PodOpts {
    owner?: K8sDockside.OwnerReference;
    phase?: string;
    statuses?: Partial<ContainerStatus>[];
    init?: Container[];
    initStatuses?: Partial<ContainerStatus>[];
    labels?: Record<string, string>;
    node?: string;
}

function pod(ns: string, name: string, containers: Container[], o: PodOpts = {}): Pod {
    uid++;
    return {
        metadata: { name, namespace: ns, uid: `pod-${uid}`, labels: o.labels, ownerReferences: o.owner ? [o.owner] : undefined },
        spec: { containers, initContainers: o.init, nodeName: o.node ?? 'node-1' },
        status: {
            phase: o.phase ?? 'Running',
            containerStatuses: (o.statuses ?? containers.map(() => ({}))).map((s, i) => ({
                name: containers[i]?.name ?? 'c',
                ready: true,
                restartCount: 0,
                state: { running: { startedAt: '2026-01-01T00:00:00Z' } },
                imageID: `docker.io/library/x@${SHA_A}`,
                ...s,
            })),
            initContainerStatuses: (o.initStatuses ?? []).map((s, i) => ({ name: o.init?.[i]?.name ?? 'i', ...s })),
        },
    };
}

function pullFailure(reason: string, message: string): Partial<ContainerStatus> {
    return { ready: false, imageID: '', state: { waiting: { reason, message } } };
}

function find(inv: { images: ImageEntry[] }, key: string): ImageEntry {
    const e = inv.images.find((i) => i.key === key);
    if (!e) throw new Error(`no image ${key}; have ${inv.images.map((i) => i.key).join(', ')}`);
    return e;
}

describe('resolveWorkload', () => {
    const rsOwners = new Map([['shop/web-7d4b9c', owner('Deployment', 'web')]]);
    const jobOwners = new Map([['batch/report-2890', owner('CronJob', 'report')]]);

    it('follows a ReplicaSet to its Deployment and a Job to its CronJob', () => {
        expect(resolveWorkload(pod('shop', 'web-7d4b9c-x', [], { owner: owner('ReplicaSet', 'web-7d4b9c') }), rsOwners, jobOwners).key).toBe('Deployment/shop/web');
        expect(resolveWorkload(pod('batch', 'report-2890-q', [], { owner: owner('Job', 'report-2890') }), rsOwners, jobOwners).key).toBe('CronJob/batch/report');
    });

    it('guesses the Deployment from pod-template-hash when ReplicaSets were not read', () => {
        const p = pod('shop', 'api-5f6d8-x', [], { owner: owner('ReplicaSet', 'api-5f6d8'), labels: { 'pod-template-hash': '5f6d8' } });
        expect(resolveWorkload(p, new Map(), jobOwners)).toMatchObject({ kind: 'Deployment', appKind: 'deployments', name: 'api' });
    });

    it('keeps StatefulSets and DaemonSets, and makes bare and static pods their own workload', () => {
        expect(resolveWorkload(pod('db', 'pg-0', [], { owner: owner('StatefulSet', 'pg') }), rsOwners, jobOwners).key).toBe('StatefulSet/db/pg');
        expect(resolveWorkload(pod('kube-system', 'kube-apiserver-cp1', [], { owner: { apiVersion: 'v1', kind: 'Node', name: 'cp1', uid: 'n', controller: true } }), rsOwners, jobOwners).key).toBe(
            'Pod/kube-system/kube-apiserver-cp1',
        );
        expect(resolveWorkload(pod('default', 'debug', []), rsOwners, jobOwners)).toMatchObject({ kind: 'Pod', appKind: 'pods' });
    });

    it('names an owner the app cannot open without an app kind', () => {
        const w = resolveWorkload(pod('shop', 'canary-x', [], { owner: { apiVersion: 'argoproj.io/v1alpha1', kind: 'Rollout', name: 'canary', uid: 'r', controller: true } }), rsOwners, jobOwners);
        expect(w).toMatchObject({ kind: 'Rollout', appKind: '' });
    });
});

describe('pullEvents', () => {
    const ev = (reason: string, message: string, at: string, fieldPath = 'spec.containers{web}'): KubeEvent => ({
        metadata: { name: `e-${++uid}`, namespace: 'shop' },
        involvedObject: { kind: 'Pod', namespace: 'shop', name: 'web-1', fieldPath },
        reason,
        message,
        lastTimestamp: at,
    });

    it('prefers the event that says why over a newer backoff', () => {
        const map = pullEvents([
            ev('Failed', 'Failed to pull image "web:9": not found', '2026-01-01T10:00:00Z'),
            ev('BackOff', 'Back-off pulling image "web:9"', '2026-01-01T10:05:00Z'),
            ev('Pulled', 'Successfully pulled image "sidecar:1"', '2026-01-01T10:06:00Z', 'spec.containers{sidecar}'),
        ]);
        expect(map.get('shop/web-1/web')).toBe('Failed to pull image "web:9": not found');
        expect(map.has('shop/web-1/sidecar')).toBe(false);
    });
});

describe('buildInventory', () => {
    function cluster(): ClusterData {
        const web = deployment('shop', 'web', [{ name: 'web', image: 'nginx:1.27' }, { name: 'metrics', image: 'prom/statsd-exporter' }]);
        const api = deployment('shop', 'api', [{ name: 'api', image: 'ghcr.io/acme/api:v2.1.0' }], [{ name: 'migrate', image: 'ghcr.io/acme/api:v2.1.0' }]);
        const idle = deployment('tools', 'toolbox', [{ name: 'box', image: 'busybox:1.36' }]);
        const report: CronJob = {
            metadata: { name: 'report', namespace: 'batch', uid: 'uid-report' },
            spec: { jobTemplate: { spec: { template: { spec: { containers: [{ name: 'report', image: `quay.io/acme/report@${SHA_A}` }] } } } } },
        };
        const reportJob: Job = { metadata: { name: 'report-2890', namespace: 'batch', uid: 'uid-report-2890', ownerReferences: [owner('CronJob', 'report', 'uid-report')] } };
        const pods: Pod[] = [
            pod('shop', 'web-7d4b9c-a', [{ name: 'web', image: 'nginx:1.27' }, { name: 'metrics', image: 'prom/statsd-exporter' }], { owner: owner('ReplicaSet', 'web-7d4b9c') }),
            pod('shop', 'web-7d4b9c-b', [{ name: 'web', image: 'nginx:1.27' }, { name: 'metrics', image: 'prom/statsd-exporter' }], {
                owner: owner('ReplicaSet', 'web-7d4b9c'),
                statuses: [{}, { imageID: `docker.io/prom/statsd-exporter@${SHA_B}` }],
            }),
            // An old pod from before the rollout, still on the old tag.
            pod('shop', 'web-5c1a2b-z', [{ name: 'web', image: 'nginx:1.25' }, { name: 'metrics', image: 'prom/statsd-exporter' }], { owner: owner('ReplicaSet', 'web-5c1a2b') }),
            pod('shop', 'api-6f7e-a', [{ name: 'api', image: 'ghcr.io/acme/api:v2.1.0' }], {
                owner: owner('ReplicaSet', 'api-6f7e'),
                init: [{ name: 'migrate', image: 'ghcr.io/acme/api:v2.1.0' }],
                initStatuses: [{ state: { terminated: { exitCode: 0, reason: 'Completed' } } }],
                statuses: [pullFailure('ImagePullBackOff', 'Back-off pulling image "ghcr.io/acme/api:v2.1.0"')],
            }),
            pod('shop', 'cart-1', [{ name: 'cart', image: 'docker.io/acme/cart:latest' }], {
                statuses: [{ ready: false, restartCount: 7, state: { waiting: { reason: 'CrashLoopBackOff', message: 'back-off 5m0s restarting failed container' } } }],
            }),
            pod('batch', 'report-2890-q', [{ name: 'report', image: `quay.io/acme/report@${SHA_A}` }], { owner: owner('Job', 'report-2890'), phase: 'Succeeded', statuses: [{ ready: false, state: { terminated: { exitCode: 0, reason: 'Completed' } } }] }),
            pod('kube-system', 'kube-proxy-x', [{ name: 'kube-proxy', image: 'k8s.gcr.io/kube-proxy:v1.26.0' }], { owner: owner('DaemonSet', 'kube-proxy') }),
            pod('default', 'starting', [{ name: 'app', image: 'nginx' }], { phase: 'Pending', statuses: [{ ready: false, imageID: '', state: { waiting: { reason: 'ContainerCreating' } } }] }),
        ];
        const events: KubeEvent[] = [
            {
                metadata: { name: 'api.1', namespace: 'shop' },
                involvedObject: { kind: 'Pod', namespace: 'shop', name: 'api-6f7e-a', fieldPath: 'spec.containers{api}' },
                reason: 'Failed',
                message: 'Failed to pull image "ghcr.io/acme/api:v2.1.0": failed to authorize: 401 Unauthorized',
                lastTimestamp: '2026-01-01T10:00:00Z',
            },
        ];
        return {
            pods,
            deployments: [web, api, idle],
            replicasets: [replicaSet('shop', 'web-7d4b9c', 'web'), replicaSet('shop', 'web-5c1a2b', 'web'), replicaSet('shop', 'api-6f7e', 'api')],
            cronjobs: [report],
            jobs: [reportJob],
            daemonsets: [],
            statefulsets: [],
            events,
        };
    }

    it('groups each image under its canonical reference', () => {
        const inv = buildInventory(cluster());
        expect(inv.images.map((i) => i.key).sort()).toEqual([
            'docker.io/acme/cart:latest',
            'docker.io/library/busybox:1.36',
            'docker.io/library/nginx:1.25',
            'docker.io/library/nginx:1.27',
            'docker.io/library/nginx:latest',
            'docker.io/prom/statsd-exporter:latest',
            'ghcr.io/acme/api:v2.1.0',
            'k8s.gcr.io/kube-proxy:v1.26.0',
            `quay.io/acme/report@${SHA_A}`,
        ]);
    });

    it('attaches pods to the workload that declares them, a Deployment rather than its ReplicaSet', () => {
        const nginx = find(buildInventory(cluster()), 'docker.io/library/nginx:1.27');
        expect(nginx.usages).toHaveLength(1);
        expect(nginx.usages[0]).toMatchObject({ workload: { kind: 'Deployment', name: 'web', appKind: 'deployments' }, container: 'web', declared: true });
        expect(nginx.usages[0]!.pods.map((p) => p.pod)).toEqual(['web-7d4b9c-a', 'web-7d4b9c-b']);
        expect(nginx.containers).toBe(2);
        expect(nginx.ready).toBe(2);
        expect(nginx.tone).toBe('ok');
        expect(nginx.issues.map((i) => i.kind)).toEqual(['unpinned']);
    });

    it('shows an old pod still running an image the template no longer names', () => {
        const old = find(buildInventory(cluster()), 'docker.io/library/nginx:1.25');
        expect(old.usages[0]).toMatchObject({ workload: { name: 'web' }, declared: false });
        expect(old.running).toBe(true);
    });

    it('diagnoses a pull failure from the events when the container only says it is backing off', () => {
        const api = find(buildInventory(cluster()), 'ghcr.io/acme/api:v2.1.0');
        const pull = api.issues.find((i) => i.kind === 'pull');
        expect(pull?.tone).toBe('error');
        expect(pull?.diagnosis?.cause).toBe('auth');
        expect(pull?.text).toMatch(/^1 container of 2 cannot pull it: the registry refused the credentials\.$/);
        expect(api.tone).toBe('error');
        expect(api.pulling).toBe(1);
        // The init container ran it fine; the main container could not pull the same tag.
        expect(api.usages.map((u) => [u.container, u.init])).toEqual([
            ['api', false],
            ['migrate', true],
        ]);
    });

    it('calls out :latest, untagged and not-ready, and leaves a container that is starting alone', () => {
        const inv = buildInventory(cluster());
        const cart = find(inv, 'docker.io/acme/cart:latest');
        expect(cart.issues.map((i) => i.kind)).toEqual(['not-ready', 'latest']);
        expect(cart.issues[0]!.text).toContain('CrashLoopBackOff');
        const statsd = find(inv, 'docker.io/prom/statsd-exporter:latest');
        expect(statsd.issues.map((i) => i.kind)).toContain('implicit');
        const starting = find(inv, 'docker.io/library/nginx:latest');
        expect(starting.issues.map((i) => i.kind)).toEqual(['implicit']);
    });

    it('notices one tag running two builds', () => {
        const statsd = find(buildInventory(cluster()), 'docker.io/prom/statsd-exporter:latest');
        const drift = statsd.issues.find((i) => i.kind === 'drift');
        expect(drift?.label).toBe('2 builds');
        expect(statsd.digests).toEqual([SHA_A, SHA_B]);
    });

    it('keeps images nothing runs right now, and says why', () => {
        const inv = buildInventory(cluster());
        const busybox = find(inv, 'docker.io/library/busybox:1.36');
        expect(busybox.running).toBe(false);
        expect(busybox.tone).toBe('muted');
        expect(busybox.issues.find((i) => i.kind === 'idle')?.text).toBe('Declared by Deployment toolbox, which has no pods running it.');
        const report = find(inv, `quay.io/acme/report@${SHA_A}`);
        expect(report.risk).toBe('pinned');
        expect(report.usages[0]!.workload.key).toBe('CronJob/batch/report');
        expect(report.containers).toBe(0);
        expect(report.issues.find((i) => i.kind === 'idle')?.text).toMatch(/CronJob report/);
    });

    it('flags the frozen k8s.gcr.io', () => {
        const proxy = find(buildInventory(cluster()), 'k8s.gcr.io/kube-proxy:v1.26.0');
        expect(proxy.issues.map((i) => i.kind)).toEqual(['frozen', 'unpinned']);
    });

    it('orders images worst first and groups them by registry and repository', () => {
        const inv = buildInventory(cluster());
        expect(inv.images[0]!.key).toBe('ghcr.io/acme/api:v2.1.0');
        expect(inv.registries.map((r) => [r.registry, r.images, r.colour])).toEqual([
            ['docker.io', 6, 0],
            ['ghcr.io', 1, 1],
            ['k8s.gcr.io', 1, 2],
            ['quay.io', 1, 3],
        ]);
        const hub = inv.registries[0]!;
        expect(hub.label).toBe('Docker Hub');
        // Worst first, then the most used: nginx has a warning (the untagged pod) and the most containers.
        expect(hub.repositories.map((r) => r.familiar)).toEqual(['nginx', 'prom/statsd-exporter', 'acme/cart', 'busybox']);
        expect(hub.repositories.find((r) => r.familiar === 'nginx')!.images.map((i) => i.ref.tag || 'latest')).toEqual(['latest', '1.27', '1.25']);
    });

    it('counts what the overview leads with', () => {
        expect(buildInventory(cluster()).totals).toEqual({
            images: 9,
            running: 7,
            registries: 4,
            namespaces: 5,
            containers: 11,
            pods: 7,
            pinned: 1,
            floating: 3,
            pullFailing: 1,
            pullContainers: 1,
            notReady: 1,
            drift: 1,
            idle: 2,
            attention: 5,
        });
    });

    it('ranks namespaces by how many images they use', () => {
        const ns = buildInventory(cluster()).namespaces;
        expect(ns[0]).toMatchObject({ namespace: 'shop', images: 5, tone: 'error' });
        expect(ns[0]!.workloads.map((w) => w.workload.name)).toEqual(['web', 'api', 'cart-1']);
    });

    it('has a signature that changes with what is drawn and only then', () => {
        const a = buildInventory(cluster()).signature;
        expect(buildInventory(cluster()).signature).toBe(a);
        const changed = cluster();
        changed.pods[0]!.status!.containerStatuses![0]!.restartCount = 1;
        expect(buildInventory(changed).signature).not.toBe(a);
    });

    it('is empty, not broken, for an empty cluster', () => {
        const inv = buildInventory({ pods: [] });
        expect(inv.images).toEqual([]);
        expect(inv.registries).toEqual([]);
        expect(inv.totals.images).toBe(0);
    });

    it('keeps an invalid reference as it was written and says so', () => {
        const inv = buildInventory({ pods: [pod('default', 'bad', [{ name: 'app', image: 'Nginx:1' }], { statuses: [pullFailure('InvalidImageName', 'Failed to apply default image tag "Nginx:1"')] })] });
        const bad = inv.images[0]!;
        expect(bad.key).toBe('Nginx:1');
        expect(bad.issues.map((i) => i.kind)).toEqual(['invalid', 'pull']);
        expect(bad.issues[1]!.diagnosis?.cause).toBe('invalid');
    });
});
