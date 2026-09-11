// The inventory: every container image the cluster runs or declares, grouped
// registry -> repository -> tag, with the workloads and pods that use each one
// and what is worth knowing about it.
//
// It is built from plain lists of objects -- pods, the workloads that own
// them, and events -- and nothing else, so it is the same whether the lists
// came from the bridge, a test, or a fixture. No DOM and no bridge in here.
//
// Two sources of images, on purpose:
//
// - pods, which say what is running now, which build of it (the digest in each
//   container status's imageID), and whether it pulled;
// - workload templates, which say what is *declared* even while nothing runs
//   it -- a CronJob between runs, a Deployment scaled to zero.

import {
    canonical,
    digestOfImageID,
    familiar,
    isFloating,
    parseImageRef,
    registryInfo,
    repositoryKey,
    shortDigest,
    tagRisk,
    type ImageRef,
    type TagRisk,
} from './image-ref';
import {
    APP_KINDS,
    controllerOf,
    eventTime,
    type Container,
    type CronJob,
    type Job,
    type KubeEvent,
    type Pod,
    type PodTemplateSpec,
    type Workload,
} from './kube';
import { diagnosePull, isPullReason, type PullDiagnosis } from './pull';

export type Tone = 'error' | 'warn' | 'info' | 'muted' | 'ok';

const TONE_RANK: Record<Tone, number> = { error: 0, warn: 1, info: 2, muted: 3, ok: 4 };

export function worse(a: Tone, b: Tone): Tone {
    return TONE_RANK[a] <= TONE_RANK[b] ? a : b;
}

export function toneRank(t: Tone): number {
    return TONE_RANK[t];
}

/** The lists an inventory is built from. Only pods are required. */
export interface ClusterData {
    pods: Pod[];
    deployments?: Workload[];
    statefulsets?: Workload[];
    daemonsets?: Workload[];
    replicasets?: Workload[];
    jobs?: Job[];
    cronjobs?: CronJob[];
    events?: KubeEvent[];
}

/** Whatever runs a pod, as far up the chain as the lists reach: Deployment rather than ReplicaSet, CronJob rather than Job. */
export interface WorkloadRef {
    /** The Kubernetes kind: Deployment, StatefulSet, DaemonSet, CronJob, Job, ReplicaSet, Pod, or an owner the app has no tab for. */
    kind: string;
    /** The app's kind to open it with; `''` for an owner the app cannot open (a custom resource) -- open a pod instead. */
    appKind: string;
    namespace: string;
    name: string;
    /** `Kind/namespace/name`. */
    key: string;
}

/** One container of one pod, running (or failing to run) an image. */
export interface PodUse {
    namespace: string;
    pod: string;
    node: string;
    container: string;
    init: boolean;
    /** The pod's phase. */
    phase: string;
    /** The pod has finished (Succeeded or Failed): it counts as history, not as running. */
    finished: boolean;
    ready: boolean;
    state: 'running' | 'waiting' | 'terminated' | 'unknown';
    /** The waiting or terminated reason: ErrImagePull, CrashLoopBackOff, Completed, … */
    reason: string;
    message: string;
    restarts: number;
    /** The digest the node actually pulled, from imageID; `''` until it has one. */
    digest: string;
    /** The container is waiting because its image will not pull. */
    pullError: boolean;
    /** The most telling pull-failure event for this container, if any. */
    eventMessage: string;
}

/** One container of one workload, using an image. */
export interface Usage {
    workload: WorkloadRef;
    container: string;
    init: boolean;
    /** The workload's template names this image -- as against only an old pod still running it. */
    declared: boolean;
    pullPolicy: string;
    pods: PodUse[];
}

export type IssueKind = 'invalid' | 'pull' | 'not-ready' | 'drift' | 'implicit' | 'latest' | 'floating' | 'frozen' | 'unpinned' | 'idle';

export interface Issue {
    kind: IssueKind;
    tone: Tone;
    /** A word or two, for a chip. */
    label: string;
    /** A sentence. */
    text: string;
    /** For a pull failure: what is wrong, in words. */
    diagnosis?: PullDiagnosis;
}

export interface ImageEntry {
    /** The canonical reference: `docker.io/library/nginx:1.27`. */
    key: string;
    ref: ImageRef;
    risk: TagRisk;
    /** Every way the reference is spelled in the cluster: `nginx`, `docker.io/library/nginx:latest`. */
    spellings: string[];
    usages: Usage[];
    namespaces: string[];
    /** Containers running it now (in pods that have not finished). */
    containers: number;
    ready: number;
    /** Containers of it that cannot pull. */
    pulling: number;
    /** Distinct digests the nodes pulled for it, most used first. */
    digests: string[];
    /** Worst first. */
    issues: Issue[];
    /** The worst of error/warn among its issues; `ok` when none, `muted` when nothing runs it. */
    tone: Tone;
    running: boolean;
}

export interface RepositoryGroup {
    key: string;
    registry: string;
    repository: string;
    /** As people write it: `nginx`, `grafana/grafana`, `ghcr.io/org/app`. */
    familiar: string;
    images: ImageEntry[];
    containers: number;
    tone: Tone;
}

export interface RegistryGroup {
    registry: string;
    label: string;
    frozen: boolean;
    local: boolean;
    repositories: RepositoryGroup[];
    images: number;
    containers: number;
    tone: Tone;
    /** 0-based position in the registry order, which decides its colour: --chart-(n+1), the eighth and after sharing --chart-8. */
    colour: number;
}

export interface NamespaceUse {
    namespace: string;
    images: number;
    containers: number;
    workloads: { workload: WorkloadRef; images: number; containers: number }[];
    tone: Tone;
}

export interface Totals {
    images: number;
    running: number;
    registries: number;
    namespaces: number;
    containers: number;
    pods: number;
    pinned: number;
    floating: number;
    pullFailing: number;
    pullContainers: number;
    notReady: number;
    drift: number;
    idle: number;
    attention: number;
}

export interface Inventory {
    /** Worst first, then most used. */
    images: ImageEntry[];
    registries: RegistryGroup[];
    namespaces: NamespaceUse[];
    totals: Totals;
    /** Changes whenever anything drawn from the inventory would; a page redraws only then. */
    signature: string;
}

// ----- pods and workloads --------------------------------------------------------

/** Reasons a container waits through on its way up, which are not worth a warning. */
const STARTING = new Set(['ContainerCreating', 'PodInitializing', '']);

function ownerIndex(list: { metadata: K8sDockside.ObjectMeta }[] | undefined): Map<string, K8sDockside.OwnerReference | null> {
    const out = new Map<string, K8sDockside.OwnerReference | null>();
    for (const obj of list ?? []) out.set(`${obj.metadata.namespace ?? ''}/${obj.metadata.name}`, controllerOf(obj as K8sDockside.KubeObject));
    return out;
}

export function workloadRef(kind: string, namespace: string, name: string): WorkloadRef {
    return { kind, appKind: APP_KINDS[kind] ?? '', namespace, name, key: `${kind}/${namespace}/${name}` };
}

/**
 * What runs a pod: its controller, followed up one more step where the lists
 * allow -- a ReplicaSet to its Deployment, a Job to its CronJob. A static pod
 * (owned by its Node) and a bare pod are their own workload.
 */
export function resolveWorkload(
    pod: Pod,
    replicaSetOwners: Map<string, K8sDockside.OwnerReference | null>,
    jobOwners: Map<string, K8sDockside.OwnerReference | null>,
): WorkloadRef {
    const ns = pod.metadata.namespace ?? '';
    const owner = controllerOf(pod);
    if (!owner || owner.kind === 'Node') return workloadRef('Pod', ns, pod.metadata.name);
    if (owner.kind === 'ReplicaSet') {
        const key = `${ns}/${owner.name}`;
        const up = replicaSetOwners.get(key);
        if (up) return workloadRef(up.kind, ns, up.name);
        // ReplicaSets not read (or not yet): a Deployment names its
        // ReplicaSets <deployment>-<pod-template-hash>, and the pod carries
        // the hash as a label.
        const hash = pod.metadata.labels?.['pod-template-hash'];
        if (!replicaSetOwners.has(key) && hash && owner.name.endsWith('-' + hash)) {
            return workloadRef('Deployment', ns, owner.name.slice(0, -hash.length - 1));
        }
    }
    if (owner.kind === 'Job') {
        const up = jobOwners.get(`${ns}/${owner.name}`);
        if (up && up.kind === 'CronJob') return workloadRef('CronJob', ns, up.name);
    }
    return workloadRef(owner.kind, ns, owner.name);
}

/** The container named in an event's fieldPath: `spec.containers{web}` -> `web`. */
function containerOfFieldPath(fieldPath: string | undefined): string {
    const m = /\{([^}]+)\}/.exec(fieldPath ?? '');
    return m?.[1] ?? '';
}

/**
 * The most telling pull-failure message per pod container, from events. The
 * kubelet's "Failed" event carries the runtime's error; "BackOff" only says it
 * is waiting, so it counts only when nothing better was seen.
 */
export function pullEvents(events: KubeEvent[] | undefined): Map<string, string> {
    const best = new Map<string, { message: string; score: number; t: number }>();
    for (const ev of events ?? []) {
        const obj = ev.involvedObject;
        if (!obj || obj.kind !== 'Pod' || !obj.name) continue;
        const message = ev.message ?? '';
        if (!/image/i.test(message)) continue;
        if (!/^(Failed|BackOff|ErrImageNeverPull|InspectFailed)$/.test(ev.reason ?? '')) continue;
        const key = `${obj.namespace ?? ev.metadata.namespace ?? ''}/${obj.name}/${containerOfFieldPath(obj.fieldPath)}`;
        const score = /^back-off pulling image/i.test(message) ? 0 : 1;
        const t = eventTime(ev);
        const have = best.get(key);
        if (!have || score > have.score || (score === have.score && t > have.t)) best.set(key, { message, score, t });
    }
    const out = new Map<string, string>();
    for (const [key, value] of best) out.set(key, value.message);
    return out;
}

/** One container of one pod, read. */
export function podUse(pod: Pod, container: Container, init: boolean, eventMessages: Map<string, string>): PodUse {
    const ns = pod.metadata.namespace ?? '';
    const phase = pod.status?.phase ?? 'Pending';
    const statuses = (init ? pod.status?.initContainerStatuses : pod.status?.containerStatuses) ?? [];
    const status = statuses.find((s) => s.name === container.name);
    const st = status?.state ?? {};
    const state = st.running ? 'running' : st.waiting ? 'waiting' : st.terminated ? 'terminated' : 'unknown';
    const reason = st.waiting?.reason ?? st.terminated?.reason ?? '';
    const message = st.waiting?.message ?? st.terminated?.message ?? '';
    let ready: boolean;
    if (init) {
        // An init container has done its job once it exits cleanly; one that
        // keeps running (a sidecar) is ready once it has started.
        ready = (!!st.terminated && (st.terminated.exitCode ?? 1) === 0) || (!!st.running && status?.started !== false);
    } else {
        ready = !!status?.ready;
    }
    return {
        namespace: ns,
        pod: pod.metadata.name,
        node: pod.spec?.nodeName ?? '',
        container: container.name,
        init,
        phase,
        finished: phase === 'Succeeded' || phase === 'Failed',
        ready,
        state,
        reason,
        message,
        restarts: status?.restartCount ?? 0,
        digest: digestOfImageID(status?.imageID),
        pullError: state === 'waiting' && isPullReason(reason),
        eventMessage: eventMessages.get(`${ns}/${pod.metadata.name}/${container.name}`) ?? '',
    };
}

/** Whether a running container's state is worth a warning: not a pull failure, and not merely starting. */
export function isUnwell(use: PodUse): boolean {
    if (use.finished || use.pullError || use.ready) return false;
    if (use.init && use.state === 'unknown') return false;
    if (use.state === 'waiting' && STARTING.has(use.reason)) return false;
    if (use.state === 'unknown') return false;
    return true;
}

// ----- building ------------------------------------------------------------------

interface Builder {
    key: string;
    ref: ImageRef;
    spellings: Set<string>;
    usages: Map<string, Usage>;
}

function templateContainers(template: PodTemplateSpec | undefined): { container: Container; init: boolean }[] {
    const spec = template?.spec;
    return [
        ...(spec?.initContainers ?? []).map((container) => ({ container, init: true })),
        ...(spec?.containers ?? []).map((container) => ({ container, init: false })),
    ];
}

export function buildInventory(data: ClusterData): Inventory {
    const builders = new Map<string, Builder>();
    const rsOwners = ownerIndex(data.replicasets);
    const jobOwners = ownerIndex(data.jobs);
    const eventMessages = pullEvents(data.events);

    function entryFor(image: string): Builder {
        const ref = parseImageRef(image);
        const key = ref.valid ? canonical(ref) : image.trim();
        let b = builders.get(key);
        if (!b) {
            b = { key, ref, spellings: new Set(), usages: new Map() };
            builders.set(key, b);
        }
        b.spellings.add(image.trim());
        return b;
    }

    function usageFor(b: Builder, workload: WorkloadRef, container: Container, init: boolean): Usage {
        const key = `${workload.key}/${init ? 'init:' : ''}${container.name}`;
        let u = b.usages.get(key);
        if (!u) {
            u = { workload, container: container.name, init, declared: false, pullPolicy: container.imagePullPolicy ?? '', pods: [] };
            b.usages.set(key, u);
        }
        return u;
    }

    function declare(kind: string, obj: { metadata: K8sDockside.ObjectMeta }, template: PodTemplateSpec | undefined): void {
        const workload = workloadRef(kind, obj.metadata.namespace ?? '', obj.metadata.name);
        for (const { container, init } of templateContainers(template)) {
            if (!container.image) continue;
            usageFor(entryFor(container.image), workload, container, init).declared = true;
        }
    }

    for (const d of data.deployments ?? []) declare('Deployment', d, d.spec?.template);
    for (const s of data.statefulsets ?? []) declare('StatefulSet', s, s.spec?.template);
    for (const d of data.daemonsets ?? []) declare('DaemonSet', d, d.spec?.template);
    for (const c of data.cronjobs ?? []) declare('CronJob', c, c.spec?.jobTemplate?.spec?.template);
    for (const j of data.jobs ?? []) {
        // A CronJob's Jobs are the CronJob's; only a Job on its own declares.
        if (controllerOf(j)?.kind !== 'CronJob') declare('Job', j, j.spec?.template);
    }

    for (const pod of data.pods) {
        const workload = resolveWorkload(pod, rsOwners, jobOwners);
        for (const { container, init } of templateContainers({ spec: pod.spec })) {
            if (!container.image) continue;
            const b = entryFor(container.image);
            usageFor(b, workload, container, init).pods.push(podUse(pod, container, init, eventMessages));
        }
    }

    const images = [...builders.values()].map(finish);
    images.sort(byConcern);

    return {
        images,
        registries: groupRegistries(images),
        namespaces: groupNamespaces(images),
        totals: totalsOf(images),
        signature: signatureOf(images),
    };
}

function finish(b: Builder): ImageEntry {
    const ref = b.ref;
    const risk = tagRisk(ref);
    const usages = [...b.usages.values()];
    for (const u of usages) u.pods.sort((a, c) => a.pod.localeCompare(c.pod));
    usages.sort(
        (a, c) =>
            live(c.pods).length - live(a.pods).length ||
            a.workload.namespace.localeCompare(c.workload.namespace) ||
            a.workload.name.localeCompare(c.workload.name) ||
            a.container.localeCompare(c.container),
    );
    const pods = usages.flatMap((u) => u.pods);
    const running = live(pods);
    const namespaces = [...new Set(usages.map((u) => u.workload.namespace))].sort();

    const digestCount = new Map<string, number>();
    for (const p of running) if (p.digest) digestCount.set(p.digest, (digestCount.get(p.digest) ?? 0) + 1);
    const digests = [...digestCount.entries()].sort((a, c) => c[1] - a[1] || a[0].localeCompare(c[0])).map(([d]) => d);

    const pulling = running.filter((p) => p.pullError);
    const unwell = running.filter(isUnwell);
    const issues: Issue[] = [];
    const name = familiar(ref);

    if (!ref.valid) {
        issues.push({ kind: 'invalid', tone: 'error', label: 'Invalid name', text: `"${ref.raw.trim()}" is not an image reference a runtime will accept: ${ref.problem}.` });
    }
    if (pulling.length) {
        const first = pulling.find((p) => p.message && !/^back-off/i.test(p.message)) ?? pulling[0]!;
        const messages = [...pulling.map((p) => p.message), ...pulling.map((p) => p.eventMessage)];
        const diagnosis = diagnosePull(first.reason, messages);
        issues.push({
            kind: 'pull',
            tone: 'error',
            label: first.reason === 'ImagePullBackOff' || first.reason === 'ErrImagePull' ? 'Pull failing' : first.reason,
            text: `${count(pulling.length, 'container')} of ${running.length} cannot pull it: ${lowerFirst(diagnosis.title)}.`,
            diagnosis,
        });
    }
    if (unwell.length) {
        const reasons = [...new Set(unwell.map((p) => p.reason || (p.state === 'running' ? 'not ready' : p.state)))];
        issues.push({
            kind: 'not-ready',
            tone: 'warn',
            label: 'Not ready',
            text: `${count(unwell.length, 'container')} of ${running.length} running it ${unwell.length === 1 ? 'is' : 'are'} not ready (${reasons.join(', ')}).`,
        });
    }
    if (!ref.digest && digests.length > 1) {
        issues.push({
            kind: 'drift',
            tone: 'warn',
            label: `${digests.length} builds`,
            text: `Pods run ${digests.length} different builds of this tag (${digests.map(shortDigest).join(', ')}): it was pushed again after some nodes pulled it.`,
        });
    }
    if (ref.valid && risk === 'implicit') {
        issues.push({ kind: 'implicit', tone: 'warn', label: 'Untagged', text: `No tag is written, so every node pulls whatever ${name}:latest is at the time.` });
    } else if (ref.valid && risk === 'latest') {
        issues.push({ kind: 'latest', tone: 'warn', label: ':latest', text: 'Which build runs depends on when each node pulled :latest.' });
    } else if (ref.valid && risk === 'floating') {
        issues.push({ kind: 'floating', tone: 'warn', label: 'Moving tag', text: `:${ref.tag} is moved on purpose, so which build runs depends on when each node pulled it.` });
    }
    if (registryInfo(ref.registry).frozen) {
        issues.push({ kind: 'frozen', tone: 'warn', label: 'Frozen registry', text: `${ref.registry} gets no new images since April 2023; the same images are on registry.k8s.io.` });
    }
    if (ref.valid && risk === 'tagged') {
        issues.push({ kind: 'unpinned', tone: 'info', label: 'Not pinned', text: 'Tagged but not pinned by digest: a push to the same tag changes what the next pod runs.' });
    }
    if (!running.length) {
        const who = usages.find((u) => u.declared)?.workload;
        issues.push({
            kind: 'idle',
            tone: 'muted',
            label: 'Not running',
            text: who
                ? who.kind === 'CronJob'
                    ? `Declared by CronJob ${who.name}; nothing runs it between jobs.`
                    : `Declared by ${who.kind} ${who.name}, which has no pods running it.`
                : 'Only finished pods ran it.',
        });
    }
    issues.sort((a, c) => TONE_RANK[a.tone] - TONE_RANK[c.tone]);

    let tone: Tone = running.length ? 'ok' : 'muted';
    for (const i of issues) if (i.tone === 'error' || i.tone === 'warn') tone = worse(tone, i.tone);

    return {
        key: b.key,
        ref,
        risk,
        spellings: [...b.spellings].sort(),
        usages,
        namespaces,
        containers: running.length,
        ready: running.filter((p) => p.ready).length,
        pulling: pulling.length,
        digests,
        issues,
        tone,
        running: running.length > 0,
    };
}

function live(pods: PodUse[]): PodUse[] {
    return pods.filter((p) => !p.finished);
}

function count(n: number, one: string, many = one + 's'): string {
    return `${n} ${n === 1 ? one : many}`;
}

function lowerFirst(s: string): string {
    return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Worst first, then the most used, then by name. */
export function byConcern(a: ImageEntry, b: ImageEntry): number {
    return TONE_RANK[a.tone] - TONE_RANK[b.tone] || b.containers - a.containers || a.key.localeCompare(b.key);
}

function groupRegistries(images: ImageEntry[]): RegistryGroup[] {
    const byRegistry = new Map<string, Map<string, ImageEntry[]>>();
    for (const image of images) {
        const repos = byRegistry.get(image.ref.registry) ?? new Map<string, ImageEntry[]>();
        byRegistry.set(image.ref.registry, repos);
        const key = repositoryKey(image.ref);
        repos.set(key, [...(repos.get(key) ?? []), image]);
    }
    const groups: RegistryGroup[] = [];
    for (const [registry, repos] of byRegistry) {
        const repositories: RepositoryGroup[] = [...repos.entries()].map(([key, list]) => {
            list.sort(byConcern);
            const first = list[0]!;
            return {
                key,
                registry,
                repository: first.ref.repository,
                familiar: familiar({ ...first.ref, tag: '', digest: '' }),
                images: list,
                containers: list.reduce((n, i) => n + i.containers, 0),
                tone: list.reduce<Tone>((t, i) => worse(t, i.tone), 'ok'),
            };
        });
        repositories.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || b.containers - a.containers || a.key.localeCompare(b.key));
        const info = registryInfo(registry);
        groups.push({
            registry,
            label: info.label,
            frozen: info.frozen,
            local: info.local,
            repositories,
            images: repositories.reduce((n, r) => n + r.images.length, 0),
            containers: repositories.reduce((n, r) => n + r.containers, 0),
            tone: repositories.reduce<Tone>((t, r) => worse(t, r.tone), 'ok'),
            colour: 0,
        });
    }
    groups.sort((a, b) => b.images - a.images || b.containers - a.containers || a.registry.localeCompare(b.registry));
    groups.forEach((g, i) => (g.colour = Math.min(i, 7)));
    return groups;
}

function groupNamespaces(images: ImageEntry[]): NamespaceUse[] {
    const byNs = new Map<string, { images: Set<string>; containers: number; tone: Tone; workloads: Map<string, { workload: WorkloadRef; images: Set<string>; containers: number }> }>();
    for (const image of images) {
        for (const u of image.usages) {
            const ns = u.workload.namespace;
            let entry = byNs.get(ns);
            if (!entry) {
                entry = { images: new Set(), containers: 0, tone: 'ok', workloads: new Map() };
                byNs.set(ns, entry);
            }
            const running = live(u.pods).length;
            entry.images.add(image.key);
            entry.containers += running;
            entry.tone = worse(entry.tone, image.tone === 'muted' ? 'ok' : image.tone);
            let w = entry.workloads.get(u.workload.key);
            if (!w) {
                w = { workload: u.workload, images: new Set(), containers: 0 };
                entry.workloads.set(u.workload.key, w);
            }
            w.images.add(image.key);
            w.containers += running;
        }
    }
    const out: NamespaceUse[] = [...byNs.entries()].map(([namespace, e]) => ({
        namespace,
        images: e.images.size,
        containers: e.containers,
        tone: e.tone,
        workloads: [...e.workloads.values()]
            .map((w) => ({ workload: w.workload, images: w.images.size, containers: w.containers }))
            .sort((a, b) => b.images - a.images || b.containers - a.containers || a.workload.name.localeCompare(b.workload.name)),
    }));
    out.sort((a, b) => b.images - a.images || b.containers - a.containers || a.namespace.localeCompare(b.namespace));
    return out;
}

function totalsOf(images: ImageEntry[]): Totals {
    const has = (i: ImageEntry, kind: IssueKind): boolean => i.issues.some((x) => x.kind === kind);
    const pods = new Set<string>();
    const namespaces = new Set<string>();
    for (const i of images) {
        for (const u of i.usages) {
            namespaces.add(u.workload.namespace);
            for (const p of u.pods) if (!p.finished) pods.add(`${p.namespace}/${p.pod}`);
        }
    }
    return {
        images: images.length,
        running: images.filter((i) => i.running).length,
        registries: new Set(images.map((i) => i.ref.registry)).size,
        namespaces: namespaces.size,
        containers: images.reduce((n, i) => n + i.containers, 0),
        pods: pods.size,
        pinned: images.filter((i) => i.risk === 'pinned').length,
        floating: images.filter((i) => isFloating(i.risk)).length,
        pullFailing: images.filter((i) => has(i, 'pull')).length,
        pullContainers: images.reduce((n, i) => n + i.pulling, 0),
        notReady: images.filter((i) => has(i, 'not-ready')).length,
        drift: images.filter((i) => has(i, 'drift')).length,
        idle: images.filter((i) => !i.running).length,
        attention: images.filter((i) => i.tone === 'error' || i.tone === 'warn').length,
    };
}

/** FNV-1a over the text, as eight hex characters: a cheap fingerprint to compare. */
export function fingerprint(text: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}

function signatureOf(images: ImageEntry[]): string {
    return fingerprint(
        JSON.stringify(
            images.map((i) => [
                i.key,
                i.tone,
                i.issues.map((x) => x.kind + x.text),
                i.usages.map((u) => [u.workload.key, u.container, u.init, u.declared, u.pods.map((p) => [p.pod, p.node, p.ready, p.state, p.reason, p.restarts, p.digest, p.finished])]),
            ]),
        ),
    );
}
