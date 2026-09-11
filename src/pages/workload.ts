// The Images panel in a workload's detail view -- a Deployment's, a
// StatefulSet's, a DaemonSet's, or a single Pod's: each container, the image
// it runs taken apart (registry, repository, tag, digest), which build the
// nodes actually pulled, and whether it pulled at all. For a workload there is
// a Restart rollout button, which asks the app to merge-patch the
// `kubectl.kubernetes.io/restartedAt` annotation onto its pod template -- the
// same thing `kubectl rollout restart` does -- after the user confirms it.
//
// Bridge calls used here: ready, object, list, get, patch, open, resize.

import { buildInventory, type ClusterData, type ImageEntry, type Inventory, type WorkloadRef } from '../model/inventory';
import { familiar, registryInfo, shortDigest } from '../model/image-ref';
import { controllerOf, type Container, type KubeEvent, type Pod, type Workload } from '../model/kube';
import { isOwnedBy, selectorString } from '../model/selector';
import { add, button, byId, chip, clear, el, icon } from '../ui/dom';
import { ago, plural } from '../ui/format';
import { banner, declined, every, message, politely, sdk } from '../ui/page';
import { diagnosisBox, issueChip, readiness, tagPill, workloadButton } from '../ui/widgets';

const POLL = 5000;
const EVENTS_EVERY = 15_000;
const RESTARTED_AT = 'kubectl.kubernetes.io/restartedAt';

/** The kinds this page is drawn for, as the manifest's sections name them. */
const KINDS: Record<string, string> = { deployments: 'Deployment', statefulsets: 'StatefulSet', daemonsets: 'DaemonSet', pods: 'Pod' };

interface State {
    ctx: K8sDockside.Context | null;
    object: Workload | Pod | null;
    pods: Pod[];
    replicasets: Workload[];
    events: KubeEvent[];
    /** For a pod: the workload it belongs to, found by following its owners. */
    owner: WorkloadRef | null;
    sig: string;
    restart: 'idle' | 'asking' | 'done';
    restartedAt: number;
    eventsRead: boolean;
}

const state: State = { ctx: null, object: null, pods: [], replicasets: [], events: [], owner: null, sig: '', restart: 'idle', restartedAt: 0, eventsRead: false };

function fail(err: unknown): void {
    banner.show(err);
}

function kind(): string {
    return state.ctx?.object?.kind ?? '';
}

function isPod(): boolean {
    return kind() === 'pods';
}

// ----- reading -------------------------------------------------------------------------

/** The workload's own pods: those its selector finds and it (or its ReplicaSets) owns. */
async function readPods(obj: Workload): Promise<void> {
    const ns = obj.metadata.namespace ?? '';
    const selector = selectorString(obj.spec?.selector);
    if (kind() === 'deployments') {
        const [rs, pods] = await Promise.all([sdk.list<Workload>({ kind: 'replicasets', namespace: ns, selector }), sdk.list<Pod>({ kind: 'pods', namespace: ns, selector })]);
        state.replicasets = rs.filter((r) => isOwnedBy(r, obj.metadata.uid));
        const uids = state.replicasets.map((r) => r.metadata.uid);
        state.pods = pods.filter((p) => uids.some((uid) => isOwnedBy(p, uid)));
    } else {
        const pods = await sdk.list<Pod>({ kind: 'pods', namespace: ns, selector });
        state.pods = pods.filter((p) => isOwnedBy(p, obj.metadata.uid));
    }
}

/** For a pod: its workload, following a ReplicaSet to its Deployment and a Job to its CronJob. */
async function readOwner(pod: Pod): Promise<void> {
    const ns = pod.metadata.namespace ?? '';
    const owner = controllerOf(pod);
    if (!owner || owner.kind === 'Node') {
        state.owner = null;
        return;
    }
    const next = owner.kind === 'ReplicaSet' ? 'replicasets' : owner.kind === 'Job' ? 'jobs' : '';
    if (next) {
        try {
            const up = controllerOf(await sdk.get({ kind: next, namespace: ns, name: owner.name }));
            if (up && (up.kind === 'Deployment' || up.kind === 'CronJob')) {
                state.owner = { kind: up.kind, appKind: up.kind === 'Deployment' ? 'deployments' : 'cronjobs', namespace: ns, name: up.name, key: `${up.kind}/${ns}/${up.name}` };
                return;
            }
        } catch {
            // Gone, or not readable: the direct owner is still worth naming.
        }
    }
    const appKinds: Record<string, string> = { ReplicaSet: 'replicasets', StatefulSet: 'statefulsets', DaemonSet: 'daemonsets', Job: 'jobs' };
    state.owner = { kind: owner.kind, appKind: appKinds[owner.kind] ?? '', namespace: ns, name: owner.name, key: `${owner.kind}/${ns}/${owner.name}` };
}

async function readEvents(): Promise<void> {
    const ns = state.ctx?.object?.namespace ?? '';
    const names = new Set(state.pods.map((p) => p.metadata.name));
    const events = await sdk.list<KubeEvent>({ kind: 'events', namespace: ns });
    state.events = events.filter((e) => e.involvedObject?.kind === 'Pod' && names.has(e.involvedObject.name ?? ''));
}

async function tick(): Promise<void> {
    const obj = await sdk.object<Workload | Pod>();
    state.object = obj;
    if (isPod()) {
        state.pods = [obj as Pod];
        if (!state.owner) await readOwner(obj as Pod);
    } else {
        await readPods(obj as Workload);
    }
    // Events explain a pull failure; they are read once the pods are known,
    // then on their own slower clock.
    if (!state.eventsRead) {
        state.eventsRead = true;
        every(EVENTS_EVERY, async () => {
            await readEvents();
            redraw();
        });
    }
    banner.clear();
    redraw();
}

// ----- the inventory of one workload -----------------------------------------------------------

function inventory(): Inventory | null {
    const obj = state.object;
    if (!obj) return null;
    const data: ClusterData = { pods: state.pods, replicasets: state.replicasets, events: state.events };
    const w = obj as Workload;
    if (kind() === 'deployments') data.deployments = [w];
    else if (kind() === 'statefulsets') data.statefulsets = [w];
    else if (kind() === 'daemonsets') data.daemonsets = [w];
    return buildInventory(data);
}

function templateContainers(): { container: Container; init: boolean }[] {
    const obj = state.object;
    const spec = isPod() ? (obj as Pod).spec : (obj as Workload).spec?.template?.spec;
    return [...(spec?.initContainers ?? []).map((container) => ({ container, init: true })), ...(spec?.containers ?? []).map((container) => ({ container, init: false }))];
}

/** The inventory entry for what a container of the template runs -- and any older image pods of it still run. */
function entriesFor(inv: Inventory, name: string, init: boolean): { current: ImageEntry | null; older: ImageEntry[] } {
    let current: ImageEntry | null = null;
    const older: ImageEntry[] = [];
    for (const entry of inv.images) {
        const u = entry.usages.find((x) => x.container === name && x.init === init);
        if (!u) continue;
        if (u.declared || isPod()) current = entry;
        else older.push(entry);
    }
    return { current, older };
}

// ----- drawing --------------------------------------------------------------------------------

function restartNote(inv: Inventory): string {
    const floating = inv.images.filter((i) => i.risk === 'latest' || i.risk === 'implicit' || i.risk === 'floating');
    if (floating.length) {
        return `Restarting replaces every pod. With pull policy Always (the default for :latest), the new pods pull whatever ${floating.map((i) => familiar(i.ref)).join(', ')} points at now.`;
    }
    if (inv.images.every((i) => i.risk === 'pinned')) return 'Restarting replaces every pod; every image is pinned by digest, so they come back on exactly the same builds.';
    return 'Restarting replaces every pod, one by one as the rollout strategy allows. A tag that was pushed again is pulled again only with pull policy Always.';
}

function drawHead(root: HTMLElement, inv: Inventory): void {
    const head = el('div', 'sec-head');
    const t = inv.totals;
    const containers = templateContainers().length;
    const summary = el('div', 'sec-summary');
    const tone = inv.images.some((i) => i.tone === 'error') ? 'error' : inv.images.some((i) => i.tone === 'warn') ? 'warn' : 'ok';
    const pinned = inv.images.filter((i) => i.risk === 'pinned' && i.usages.some((u) => u.declared || isPod())).length;
    add(
        summary,
        el('i', 'sdot ' + tone),
        el('strong', '', plural(containers, 'container')),
        el('span', 'faint', ' · '),
        el('span', '', plural(t.images, 'image')),
        el('span', 'faint', ' · '),
        el('span', pinned === t.images && t.images ? 'ok-text' : '', pinned === t.images && t.images ? 'all pinned by digest' : `${pinned} of ${t.images} pinned`),
    );
    head.appendChild(summary);

    if (isPod()) {
        if (state.owner) {
            const part = el('div', 'sec-owner');
            add(part, el('span', 'faint small', 'Part of'), workloadButton(state.owner, (w) => w.appKind && sdk.open({ kind: w.appKind, namespace: w.namespace, name: w.name }).catch(fail), { namespace: false }));
            head.appendChild(part);
        }
    } else if (state.ctx?.write) {
        const b = button(state.restart === 'asking' ? 'Waiting for your answer…' : 'Restart rollout', 'small' + (state.restart === 'asking' ? '' : ' primary'), 'restart', restart);
        b.disabled = state.restart === 'asking';
        b.dataset.focus = 'restart';
        b.title = restartNote(inv);
        head.appendChild(b);
    }
    root.appendChild(head);
}

function containerBlock(inv: Inventory, container: Container, init: boolean): HTMLElement {
    const { current, older } = entriesFor(inv, container.name, init);
    const box = el('article', 'ctr ' + (current?.tone ?? 'muted'));
    const top = el('div', 'ctr-top');
    const name = el('span', 'ctr-name');
    add(name, icon(init ? 'init' : 'container'), el('span', '', container.name), init ? el('span', 'badge', 'init') : null);
    top.appendChild(name);
    top.appendChild(el('span', 'push'));
    if (current && current.containers) top.appendChild(readiness(current.ready, current.containers, current.pulling));
    box.appendChild(top);

    if (!current) {
        box.appendChild(el('p', 'quiet small', container.image ? 'No pod runs this container yet.' : 'This container names no image.'));
        return box;
    }

    const ref = current.ref;
    const image = el('div', 'ctr-image');
    const code = el('code', 'ctr-ref', container.image ?? current.key);
    code.title = current.key;
    add(image, code, tagPill(current));
    box.appendChild(image);

    const facts = el('div', 'ctr-facts');
    const info = registryInfo(ref.registry);
    const fact = (label: string, value: string, title?: string, className = ''): HTMLElement => {
        const f = el('span', 'ctr-fact' + (className ? ' ' + className : ''));
        add(f, el('span', 'ctr-fact-label', label), el('span', 'ctr-fact-value', value));
        if (title) f.title = title;
        return f;
    };
    add(
        facts,
        fact('Registry', info.label === ref.registry ? ref.registry : `${info.label} (${ref.registry})`, ref.implicitRegistry ? 'Not written: Docker Hub is assumed' : undefined),
        fact('Repository', ref.repository || '—'),
        fact('Tag', ref.tag || (ref.digest ? 'none — digest only' : 'latest (not written)'), undefined, ref.tag && ref.tag.toLowerCase() !== 'latest' ? '' : ref.digest ? '' : 'warn'),
        ref.digest
            ? fact('Digest', shortDigest(ref.digest), ref.digest, 'ok')
            : current.digests.length > 1
              ? fact('Running', `${current.digests.length} different builds`, current.digests.join('\n'), 'warn')
              : current.digests.length === 1
                ? fact('Running', shortDigest(current.digests[0]!), `The nodes pulled ${current.digests[0]} for this tag. Write it after the tag (…@${current.digests[0]}) to pin it.`)
                : fact('Running', current.containers ? 'nothing pulled yet' : 'no pod runs it'),
        fact(
            'Pull policy',
            container.imagePullPolicy || (ref.digest || (ref.tag && ref.tag.toLowerCase() !== 'latest') ? 'IfNotPresent (default)' : 'Always (default)'),
            'Unset, it is IfNotPresent -- or Always for :latest and an untagged image.',
        ),
    );
    box.appendChild(facts);

    const issues = current.issues.filter((i) => i.kind !== 'idle' && i.kind !== 'unpinned');
    for (const issue of issues) {
        const line = el('div', 'ctr-issue ' + issue.tone);
        add(line, issueChip(issue), el('span', '', issue.text));
        box.appendChild(line);
        const why = diagnosisBox(issue);
        if (why) box.appendChild(why);
    }

    for (const old of older) {
        const pods = old.usages.filter((u) => u.container === container.name && u.init === init).reduce((n, u) => n + u.pods.filter((p) => !p.finished).length, 0);
        if (!pods) continue;
        const line = el('div', 'ctr-issue info');
        add(line, chip('rolling out', 'info', 'clock'), el('span', '', `${plural(pods, 'pod')} still ${pods === 1 ? 'runs' : 'run'} ${familiar(old.ref, { shortDigest: true })} from before the last change.`));
        box.appendChild(line);
    }
    return box;
}

function draw(): void {
    const root = byId('root');
    clear(root);
    const inv = inventory();
    if (!inv) return;
    drawHead(root, inv);

    const list = el('div', 'ctr-list');
    for (const { container, init } of templateContainers()) list.appendChild(containerBlock(inv, container, init));
    root.appendChild(list);

    if (!isPod()) {
        const foot = el('div', 'sec-foot');
        const annotations = (state.object as Workload).spec?.template?.metadata?.annotations ?? {};
        const restartedAt = Date.parse(annotations[RESTARTED_AT] ?? '');
        if (state.restart === 'done') {
            const ok = el('div', 'notice');
            add(ok, icon('check'), el('span', '', 'Restart applied — the pods are being replaced. This panel follows them as they come up.'));
            foot.appendChild(ok);
        }
        const note = el('p', 'faint small');
        const last = Number.isFinite(restartedAt) ? `Last restarted ${ago(restartedAt)}. ` : '';
        note.textContent = state.ctx?.write ? last + restartNote(inv) : last + 'This plugin is read-only here ("ui": { "write": false }), so it offers no restart.';
        foot.appendChild(note);
        root.appendChild(foot);
    } else if (state.owner && state.owner.kind !== 'Pod') {
        root.appendChild(el('p', 'faint small sec-foot', `To pull its images again, restart ${state.owner.kind} ${state.owner.name} — a pod’s images cannot change in place.`));
    }

    // The SDK follows the page's height by itself; saying it once more after
    // a redraw costs nothing and settles the frame a beat sooner.
    void sdk.resize(Math.ceil(document.documentElement.scrollHeight));
}

const drawPolitely = politely(document.body, draw);

function redraw(force = false): void {
    const inv = inventory();
    const sig = (inv?.signature ?? '') + '|' + state.restart + '|' + Math.floor(Date.now() / 60_000) + '|' + ((state.object as Workload | null)?.spec?.template?.metadata?.annotations?.[RESTARTED_AT] ?? '') + (state.owner?.key ?? '');
    if (sig === state.sig && !force) return;
    state.sig = sig;
    drawPolitely();
}

// ----- restarting -----------------------------------------------------------------------------------

/**
 * `kubectl rollout restart`, through the bridge: a new timestamp in the pod
 * template's annotations changes the template, and the controller replaces
 * every pod. The app shows the patch and waits for the user's yes.
 */
function restart(): void {
    const obj = state.ctx?.object;
    if (!obj || state.restart === 'asking') return;
    state.restart = 'asking';
    redraw(true);
    sdk.patch({
        kind: obj.kind,
        namespace: obj.namespace,
        name: obj.name,
        patch: { spec: { template: { metadata: { annotations: { [RESTARTED_AT]: new Date().toISOString() } } } } },
    })
        .then(() => {
            state.restart = 'done';
            state.restartedAt = Date.now();
            return tick();
        })
        .catch((err: unknown) => {
            state.restart = 'idle';
            if (!declined(err)) fail(new Error('The restart was not applied: ' + message(err)));
            redraw(true);
        });
}

// ----- wiring -----------------------------------------------------------------------------------------

sdk.ready()
    .then((ctx) => {
        state.ctx = ctx;
        if (!ctx.object || !KINDS[ctx.object.kind]) {
            byId('root').textContent = 'This page is a panel for a Deployment, StatefulSet, DaemonSet or Pod.';
            return;
        }
        every(POLL, tick);
        // A "done" notice is news for a little while, not for ever.
        setInterval(() => {
            if (state.restart === 'done' && Date.now() - state.restartedAt > 60_000) {
                state.restart = 'idle';
                redraw(true);
            }
        }, 5000);
    })
    .catch(fail);
