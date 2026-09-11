// The Images view: every image in the cluster, grouped registry ->
// repository -> tag, searchable and filterable, with the workloads and pods
// that use each one. A workload opens in the app's details panel, a pod's
// logs in the app's log view, a workload's YAML in its editor.
//
// Bridge calls used here: ready, watch (through the feed), namespaces, open,
// edit, logs.

import { startFeed, type FeedState } from '../model/feed';
import { familiar, familiarRepository, registryInfo, shortDigest } from '../model/image-ref';
import { buildInventory, type ImageEntry, type Inventory, type PodUse, type RegistryGroup, type Usage, type WorkloadRef } from '../model/inventory';
import { add, button, byId, chip, clear, el, icon, iconButton, linkButton, type Child } from '../ui/dom';
import { plural } from '../ui/format';
import type { IconName } from '../ui/icons';
import { banner, every, politely, readHash, sdk, writeHash } from '../ui/page';
import { diagnosisBox, issueChip, issueChips, podState, readiness, registryTile, swatch, tagPill, workloadButton } from '../ui/widgets';

const NAMESPACES_EVERY = 30_000;
const PODS_SHOWN = 12;

type Show = 'all' | 'attention' | 'pull' | 'floating' | 'unpinned' | 'pinned' | 'idle';

const SHOWS: { id: Show; label: string; icon: IconName; test: (i: ImageEntry) => boolean }[] = [
    { id: 'all', label: 'All images', icon: 'grid', test: () => true },
    { id: 'attention', label: 'Needs attention', icon: 'alert', test: (i) => i.tone === 'error' || i.tone === 'warn' },
    { id: 'pull', label: 'Failing to pull', icon: 'failed', test: (i) => i.issues.some((x) => x.kind === 'pull' || x.kind === 'invalid') },
    { id: 'floating', label: 'Floating tags', icon: 'moving', test: (i) => i.risk === 'latest' || i.risk === 'implicit' || i.risk === 'floating' },
    { id: 'unpinned', label: 'Tagged, not pinned', icon: 'unlock', test: (i) => i.risk === 'tagged' },
    { id: 'pinned', label: 'Pinned by digest', icon: 'lock', test: (i) => i.risk === 'pinned' },
    { id: 'idle', label: 'Not running', icon: 'clock', test: (i) => !i.running },
];

interface State {
    ctx: K8sDockside.Context | null;
    feed: FeedState | null;
    inventory: Inventory | null;
    sig: string;
    namespaces: string[];
    query: string;
    show: Show;
    registry: string;
    namespace: string;
    open: Set<string>;
    allPods: Set<string>;
}

const hash = readHash();
const state: State = {
    ctx: null,
    feed: null,
    inventory: null,
    sig: '',
    namespaces: [],
    query: hash.q ?? '',
    show: SHOWS.some((s) => s.id === hash.show) ? (hash.show as Show) : 'all',
    registry: hash.reg ?? '',
    namespace: hash.ns ?? '',
    open: new Set((hash.open ?? '').split('|').filter(Boolean)),
    allPods: new Set(),
};

function remember(): void {
    writeHash({ q: state.query, show: state.show !== 'all' && state.show, reg: state.registry, ns: state.namespace, open: [...state.open].join('|') });
}

function fail(err: unknown): void {
    banner.show(err);
}

// ----- opening things in the app -----------------------------------------------------

function openWorkload(w: WorkloadRef, usage?: Usage): void {
    if (w.appKind) {
        sdk.open({ kind: w.appKind, namespace: w.namespace, name: w.name }).catch(fail);
        return;
    }
    const pod = usage?.pods[0];
    if (pod) openPod(pod);
}

function openPod(p: PodUse): void {
    sdk.open({ kind: 'pods', namespace: p.namespace, name: p.pod }).catch(fail);
}

// ----- which images are shown ------------------------------------------------------------

function inNamespace(entry: ImageEntry): boolean {
    return !state.namespace || entry.namespaces.includes(state.namespace);
}

function matchesQuery(entry: ImageEntry): boolean {
    const q = state.query.trim().toLowerCase();
    if (!q) return true;
    const hay = [entry.key, familiar(entry.ref), registryInfo(entry.ref.registry).label, ...entry.spellings, ...entry.namespaces, ...entry.digests];
    for (const u of entry.usages) {
        hay.push(u.workload.name, u.container);
        for (const p of u.pods) hay.push(p.pod, p.node);
    }
    return q.split(/\s+/).every((word) => hay.some((h) => h.toLowerCase().includes(word)));
}

/** Images in scope: the namespace and the search, before the status and registry filters. */
function scoped(inv: Inventory): ImageEntry[] {
    return inv.images.filter((i) => inNamespace(i) && matchesQuery(i));
}

function visible(inv: Inventory): ImageEntry[] {
    const test = SHOWS.find((s) => s.id === state.show)?.test ?? (() => true);
    return scoped(inv).filter((i) => test(i) && (!state.registry || i.ref.registry === state.registry));
}

// ----- the rail of filters ---------------------------------------------------------------

function drawFilters(inv: Inventory): void {
    const nav = byId('filters');
    clear(nav);
    // Faceted: each group counts what picking one of its entries would show,
    // given the other group's pick.
    const inScope = scoped(inv);
    const statusTest = SHOWS.find((s) => s.id === state.show)?.test ?? (() => true);
    const byRegistry = inScope.filter((i) => !state.registry || i.ref.registry === state.registry);
    const byStatus = inScope.filter(statusTest);

    const shows = el('div', 'filter-group');
    shows.appendChild(el('div', 'mini-title', 'Show'));
    for (const s of SHOWS) {
        const n = byRegistry.filter(s.test).length;
        if (n === 0 && s.id !== 'all' && s.id !== state.show) continue;
        const b = button('', 'filter' + (state.show === s.id ? ' on' : '') + (s.id === 'attention' && n ? ' warn' : '') + (s.id === 'pull' && n ? ' error' : ''), s.icon, () => {
            state.show = s.id;
            remember();
            redrawAll();
        });
        b.dataset.focus = 'show:' + s.id;
        b.setAttribute('aria-pressed', String(state.show === s.id));
        add(b, el('span', 'filter-label', s.label), el('span', 'filter-count', String(n)));
        shows.appendChild(b);
    }
    nav.appendChild(shows);

    const regs = el('div', 'filter-group');
    regs.appendChild(el('div', 'mini-title', 'Registries'));
    const all = button('', 'filter' + (state.registry ? '' : ' on'), 'registry', () => {
        state.registry = '';
        remember();
        redrawAll();
    });
    all.dataset.focus = 'reg:';
    add(all, el('span', 'filter-label', 'Every registry'), el('span', 'filter-count', String(byStatus.length)));
    regs.appendChild(all);
    for (const g of inv.registries) {
        const n = byStatus.filter((i) => i.ref.registry === g.registry).length;
        if (!n && state.registry !== g.registry) continue;
        const b = button('', 'filter reg' + (state.registry === g.registry ? ' on' : ''), null, () => {
            state.registry = state.registry === g.registry ? '' : g.registry;
            remember();
            redrawAll();
        });
        b.dataset.focus = 'reg:' + g.registry;
        b.title = g.registry;
        b.setAttribute('aria-pressed', String(state.registry === g.registry));
        add(b, swatch(g.colour), el('span', 'filter-label', g.label), el('span', 'filter-count', String(n)));
        regs.appendChild(b);
    }
    nav.appendChild(regs);
}

// ----- one image's row, and what it opens into -------------------------------------------------

function usageLine(entry: ImageEntry): HTMLElement {
    const line = el('div', 'tag-used');
    const byWorkload = new Map<string, { usage: Usage; running: number }>();
    for (const u of entry.usages) {
        if (state.namespace && u.workload.namespace !== state.namespace) continue;
        const have = byWorkload.get(u.workload.key);
        const running = u.pods.filter((p) => !p.finished).length;
        if (have) have.running += running;
        else byWorkload.set(u.workload.key, { usage: u, running });
    }
    const list = [...byWorkload.values()];
    for (const { usage, running } of list.slice(0, 3)) {
        line.appendChild(workloadButton(usage.workload, (w) => openWorkload(w, usage), { detail: running ? `×${running}` : usage.declared ? 'idle' : '' }));
    }
    if (list.length > 3) line.appendChild(el('span', 'faint small', `+${list.length - 3} more`));
    return line;
}

/** Which build a tag resolved to on the nodes -- when it is one; several are an issue chip of their own. */
function digestFact(entry: ImageEntry): HTMLElement | null {
    const only = entry.digests.length === 1 ? entry.digests[0] : undefined;
    if (entry.ref.digest || !only) return null;
    const node = el('span', 'digest-fact');
    add(node, icon('digest'), el('code', '', shortDigest(only)));
    node.title = `The nodes pulled ${only} for this tag. Write it after the tag to pin it.`;
    return node;
}

function tagRow(entry: ImageEntry): HTMLElement {
    const isOpen = state.open.has(entry.key);
    const row = el('article', 'tag-row ' + entry.tone + (isOpen ? ' open' : ''));
    const head = el('div', 'tag-head');
    const toggle = iconButton(isOpen ? 'chevron-down' : 'chevron', isOpen ? 'Hide the pods' : 'Show the pods', () => {
        if (state.open.has(entry.key)) state.open.delete(entry.key);
        else state.open.add(entry.key);
        remember();
        drawList();
    }, 'tag-toggle');
    toggle.dataset.focus = 'toggle:' + entry.key;
    toggle.setAttribute('aria-expanded', String(isOpen));
    const chips = el('span', 'tag-chips');
    add(chips, ...issueChips(entry, { tag: false }));
    // One line on a wide screen: the tag and what is known about it on the
    // left, who uses it and how that is going on the right.
    const right = el('span', 'tag-right');
    add(right, usageLine(entry), readiness(entry.ready, entry.containers, entry.pulling));
    add(head, toggle, tagPill(entry), digestFact(entry), chips, right);
    row.appendChild(head);
    if (isOpen) row.appendChild(detail(entry));
    return row;
}

function fact(label: string, ...value: Child[]): HTMLElement {
    const node = el('div', 'fact');
    add(node, el('span', 'fact-label', label), add(el('span', 'fact-value'), ...value));
    return node;
}

function detail(entry: ImageEntry): HTMLElement {
    const box = el('div', 'tag-detail');

    const issues = entry.issues.filter((i) => i.kind !== 'idle' || !entry.running);
    if (issues.length) {
        const list = el('ul', 'issue-list');
        for (const issue of issues) {
            const li = el('li', 'issue ' + issue.tone);
            add(li, issueChip(issue), el('span', 'issue-text', issue.text));
            list.appendChild(li);
            const why = diagnosisBox(issue);
            if (why) list.appendChild(add(el('li', 'issue-why'), why));
        }
        box.appendChild(list);
    }

    const facts = el('div', 'facts');
    const canonical = el('code', 'copyable', entry.key);
    canonical.title = 'Select to copy';
    facts.appendChild(fact('Reference', canonical));
    if (entry.spellings.length > 1 || entry.spellings[0] !== entry.key) {
        facts.appendChild(fact('Written as', ...entry.spellings.map((s) => el('code', 'name-chip', s))));
    }
    const info = registryInfo(entry.ref.registry);
    facts.appendChild(fact('Registry', el('span', '', info.label === entry.ref.registry ? entry.ref.registry : `${info.label} · ${entry.ref.registry}`), entry.ref.implicitRegistry ? el('span', 'faint', ' (assumed: no registry is written)') : null));
    if (entry.digests.length) {
        facts.appendChild(
            fact(
                entry.ref.digest ? 'Pinned to' : entry.digests.length > 1 ? 'Running builds' : 'Running build',
                ...(entry.ref.digest ? [entry.ref.digest] : entry.digests).map((d) => el('code', 'name-chip digest', d)),
            ),
        );
    }
    box.appendChild(facts);

    const table = el('div', 'uses');
    for (const u of entry.usages) {
        if (state.namespace && u.workload.namespace !== state.namespace) continue;
        table.appendChild(usageBlock(entry, u));
    }
    box.appendChild(table);
    return box;
}

function usageBlock(entry: ImageEntry, u: Usage): HTMLElement {
    const block = el('section', 'use');
    const head = el('div', 'use-head');
    const who = workloadButton(u.workload, (w) => openWorkload(w, u));
    const container = el('span', 'use-container');
    add(container, icon(u.init ? 'init' : 'container'), el('span', '', u.container), u.init ? el('span', 'badge', 'init') : null);
    container.title = u.init ? 'An init container: it runs to completion before the others start' : 'Container';
    add(head, who, container);
    if (u.pullPolicy) head.appendChild(el('span', 'use-policy', 'pull ' + u.pullPolicy));
    if (!u.declared && u.workload.kind !== 'Pod') {
        head.appendChild(chip('old version', 'info', 'clock', `${u.workload.kind} ${u.workload.name} no longer names this image; these pods are from before its last change`));
    }
    head.appendChild(el('span', 'push'));
    if (u.workload.appKind && u.workload.kind !== 'Pod') {
        const yaml = iconButton('edit', `Edit ${u.workload.kind} ${u.workload.name} as YAML`, () =>
            sdk.edit({ kind: u.workload.appKind, namespace: u.workload.namespace, name: u.workload.name }).catch(fail),
        );
        yaml.dataset.focus = 'yaml:' + entry.key + u.workload.key + u.container;
        head.appendChild(yaml);
    }
    block.appendChild(head);

    if (!u.pods.length) {
        block.appendChild(el('p', 'quiet small', u.workload.kind === 'CronJob' ? 'No job is running it right now.' : 'No pod is running it right now.'));
        return block;
    }
    const key = entry.key + '|' + u.workload.key + '|' + u.container;
    const pods = state.allPods.has(key) ? u.pods : u.pods.slice(0, PODS_SHOWN);
    const list = el('ul', 'pods');
    for (const p of pods) list.appendChild(podRow(p, entry));
    block.appendChild(list);
    if (u.pods.length > PODS_SHOWN) {
        const more = button(state.allPods.has(key) ? 'Show fewer' : `Show all ${u.pods.length} pods`, 'ghost small', 'chevron-down', () => {
            if (state.allPods.has(key)) state.allPods.delete(key);
            else state.allPods.add(key);
            drawList();
        });
        more.dataset.focus = 'more:' + key;
        block.appendChild(more);
    }
    return block;
}

function podRow(p: PodUse, entry: ImageEntry): HTMLElement {
    const li = el('li', 'pod-row');
    const s = podState(p);
    const name = linkButton(p.pod, () => openPod(p), `Open pod ${p.namespace}/${p.pod}`);
    name.dataset.focus = 'pod:' + entry.key + p.pod + p.container;
    const where = el('span', 'pod-node');
    if (p.node) add(where, icon('node'), el('span', '', p.node));
    else where.appendChild(el('span', 'faint', 'not scheduled'));
    const digest = el('code', 'pod-digest', p.digest ? shortDigest(p.digest) : '—');
    digest.title = p.digest ? `This container runs ${p.digest}` : 'No image pulled yet';
    if (p.digest && entry.digests.length > 1 && p.digest !== entry.digests[0]) digest.classList.add('odd');
    const logs = iconButton('logs', `Logs of ${p.pod}`, () => sdk.logs({ kind: 'pods', namespace: p.namespace, name: p.pod }).catch(fail));
    logs.dataset.focus = 'logs:' + entry.key + p.pod + p.container;
    add(
        li,
        el('i', 'sdot ' + s.tone),
        name,
        el('span', 'pod-state ' + s.tone, s.text),
        p.restarts ? el('span', 'pod-restarts', `${plural(p.restarts, 'restart')}`) : null,
        where,
        digest,
        logs,
    );
    if (p.pullError || (!p.ready && p.message && !p.finished)) {
        li.title = p.message || p.eventMessage;
    }
    return li;
}

// ----- the list -----------------------------------------------------------------------------

function registrySection(g: RegistryGroup, images: ImageEntry[]): HTMLElement {
    const section = el('section', 'reg-group');
    const head = el('header', 'reg-head');
    const names = el('div', 'reg-head-names');
    const title = el('h2', '', g.label);
    add(names, title, g.label !== g.registry ? el('code', 'reg-head-host', g.registry) : null);
    const containers = images.reduce((n, i) => n + i.containers, 0);
    add(
        head,
        registryTile(g.colour),
        names,
        g.frozen ? chip('frozen', 'warn', 'snowflake', `${g.registry} gets no new images since April 2023; the same images are on registry.k8s.io`) : null,
        g.local ? chip('local', 'muted', 'node') : null,
        el('span', 'push'),
        el('span', 'reg-head-count', `${plural(images.length, 'image')} · ${plural(containers, 'container')}`),
    );
    section.appendChild(head);

    const byRepo = new Map<string, ImageEntry[]>();
    for (const repo of g.repositories) {
        const list = repo.images.filter((i) => images.includes(i));
        if (list.length) byRepo.set(repo.key, list);
    }
    for (const [key, list] of byRepo) {
        const repo = el('div', 'repo');
        const rhead = el('div', 'repo-head');
        const first = list[0]!;
        const name = el('code', 'repo-name', first.ref.valid ? familiarRepository(first.ref) : first.ref.raw.trim());
        name.title = key;
        add(rhead, icon('repo'), name, el('span', 'push'), el('span', 'repo-count', `${plural(list.length, 'tag')} · ${plural(list.reduce((n, i) => n + i.containers, 0), 'container')}`));
        repo.appendChild(rhead);
        for (const entry of list) repo.appendChild(tagRow(entry));
        section.appendChild(repo);
    }
    return section;
}

function drawList(): void {
    const inv = state.inventory;
    const list = byId('list');
    clear(list);
    if (!inv) return;
    const shown = visible(inv);
    if (!shown.length) {
        const none = el('div', 'none');
        add(none, icon('search'), el('p', '', 'No image matches' + (state.query ? ` “${state.query}”` : '') + (state.namespace ? ` in ${state.namespace}` : '') + '.'));
        none.appendChild(
            button('Clear filters', 'ghost small', 'close', () => {
                state.query = '';
                state.show = 'all';
                state.registry = '';
                state.namespace = '';
                byId<HTMLInputElement>('query').value = '';
                byId<HTMLSelectElement>('namespace').value = '';
                remember();
                redrawAll();
            }),
        );
        list.appendChild(none);
        return;
    }
    for (const g of inv.registries) {
        const images = shown.filter((i) => i.ref.registry === g.registry);
        if (images.length) list.appendChild(registrySection(g, images));
    }
}

function drawWhere(): void {
    const inv = state.inventory;
    const parts = [state.ctx?.contextName ?? ''];
    if (inv) parts.push(plural(inv.totals.images, 'image'), plural(inv.totals.registries, 'registry', 'registries'));
    if (inv && inv.totals.attention) parts.push(`${inv.totals.attention} need${inv.totals.attention === 1 ? 's' : ''} attention`);
    byId('where').textContent = parts.filter(Boolean).join(' · ');
}

function drawNamespaces(): void {
    const select = byId<HTMLSelectElement>('namespace');
    // Leave it alone while it is open or focused: rebuilding it would close it.
    if (document.activeElement === select) return;
    const inv = state.inventory;
    const counts = new Map<string, number>();
    for (const i of inv?.images ?? []) for (const ns of i.namespaces) counts.set(ns, (counts.get(ns) ?? 0) + 1);
    const names = [...new Set([...state.namespaces, ...counts.keys(), ...(state.namespace ? [state.namespace] : [])])].sort();
    const want = ['', ...names].map((ns) => `${ns}:${counts.get(ns) ?? ''}`).join('|');
    if (select.dataset.options === want) return;
    select.dataset.options = want;
    clear(select);
    const anywhere = el('option', '', `Every namespace (${inv?.totals.images ?? 0})`);
    anywhere.value = '';
    select.appendChild(anywhere);
    for (const ns of names) {
        const option = el('option', '', `${ns} (${counts.get(ns) ?? 0})`);
        option.value = ns;
        select.appendChild(option);
    }
    select.value = state.namespace;
}

function redrawAll(): void {
    const inv = state.inventory;
    const empty = byId('empty');
    const body = byId('body');
    drawWhere();
    if (!inv) return;
    drawNamespaces();
    if (!inv.images.length) {
        body.hidden = true;
        empty.hidden = false;
        clear(empty);
        const art = el('div', 'empty-art');
        art.appendChild(icon('logo'));
        add(empty, art, el('h2', '', 'No images yet'), el('p', 'faint', 'No pod or workload in this cluster names a container image. Deploy something and it shows up here within a few seconds.'));
        return;
    }
    empty.hidden = true;
    body.hidden = false;
    drawFilters(inv);
    drawList();
}

// ----- wiring ---------------------------------------------------------------------------------------

byId('logo').appendChild(icon('logo'));
byId('search-icon').appendChild(icon('search'));
const query = byId<HTMLInputElement>('query');
query.value = state.query;
query.addEventListener('input', () => {
    state.query = query.value;
    remember();
    if (state.inventory) {
        drawFilters(state.inventory);
        drawList();
    }
});
query.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && query.value) {
        query.value = '';
        query.dispatchEvent(new Event('input'));
    }
});
document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement === document.body) {
        event.preventDefault();
        query.focus();
    }
});
const nsSelect = byId<HTMLSelectElement>('namespace');
nsSelect.addEventListener('change', () => {
    state.namespace = nsSelect.value;
    remember();
    redrawAll();
    nsSelect.blur();
});

// A poll's redraw waits while the user is pressing, selecting or typing in the list.
const redrawList = politely(byId('list'), () => {
    if (state.inventory) drawFilters(state.inventory);
    drawList();
});

function onFeed(feed: FeedState): void {
    state.feed = feed;
    if (feed.errors.pods) banner.show(feed.errors.pods);
    else banner.clear();
    if (!feed.ready) return;
    const inv = buildInventory(feed.data);
    if (inv.signature === state.sig) return;
    const first = !state.inventory;
    state.inventory = inv;
    state.sig = inv.signature;
    // The frame around the list (counts, namespaces) is always safe to
    // update; the list itself waits for the user.
    drawWhere();
    drawNamespaces();
    if (first || !inv.images.length || byId('body').hidden) redrawAll();
    else redrawList();
}

sdk.ready()
    .then((ctx) => {
        state.ctx = ctx;
        drawWhere();
        startFeed(sdk, { onChange: onFeed });
        every(NAMESPACES_EVERY, async () => {
            state.namespaces = await sdk.namespaces();
            if (state.inventory) drawNamespaces();
        });
    })
    .catch(fail);
