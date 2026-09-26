// The Updates view: which images running in the cluster have something newer
// in their registries -- a newer patch, minor or major version of a version
// tag, or a newer build behind a tag like `latest`.
//
// The page has no network of its own. The app asks each image's registry on
// its behalf (`registry.lookup`) -- anonymously, so only public images can be
// checked -- and keeps an answer for about half an hour. The page asks once
// per image that runs, a few at a time, and fills the list in as the answers
// come back; Check again asks afresh. Everything it concludes is worked out
// in src/model/updates.ts and src/model/versions.ts.
//
// Bridge calls used here: ready, watch (through the feed), registry.lookup,
// open, openUrl.

import { startFeed, type FeedState } from '../model/feed';
import { familiar, familiarRepository, shortDigest, type ImageRef } from '../model/image-ref';
import { buildInventory, type Inventory, type Usage, type WorkloadRef } from '../model/inventory';
import { buildUpdates, FAILURE_LABEL, hasUpdate, refusedLookup, tagsPage, type UpdateReport, type UpdateRow, type UpdateState, type UpdateSummary } from '../model/updates';
import type { UpdateKind } from '../model/versions';
import { add, button, byId, chip, clear, el, icon, iconButton, type Child, type ChipTone } from '../ui/dom';
import { ago, plural } from '../ui/format';
import type { IconName } from '../ui/icons';
import { banner, keepFocus, message, politely, readHash, sdk, writeHash } from '../ui/page';
import { swatch, tagPill, workloadButton } from '../ui/widgets';

/** Registry questions in flight at once. The app asks one registry per question, so this is also how hard the page leans on them. */
const IN_FLIGHT = 4;
/** On this page only a new image matters, so pods are read less often than on the others. */
const PODS_EVERY = 15_000;
const OWNERS_EVERY = 60_000;
/** Answers arrive in bursts; the page is drawn at most this often while they do. */
const DRAW_AFTER = 150;
const WORKLOADS_SHOWN = 3;

type Show = 'all' | 'updates' | 'major' | 'minor' | 'patch' | 'rebuilt' | 'current' | 'unknown' | 'failed';

const SHOWS: { id: Show; label: string; icon: IconName; test: (r: UpdateRow) => boolean }[] = [
    { id: 'all', label: 'All', icon: 'grid', test: () => true },
    { id: 'updates', label: 'Updates', icon: 'update', test: (r) => hasUpdate(r.state) },
    { id: 'major', label: 'Major', icon: 'update', test: (r) => r.state === 'major' },
    { id: 'minor', label: 'Minor', icon: 'update', test: (r) => r.state === 'minor' },
    { id: 'patch', label: 'Patch', icon: 'update', test: (r) => r.state === 'patch' },
    { id: 'rebuilt', label: 'Rebuilt', icon: 'digest', test: (r) => r.state === 'rebuilt' },
    { id: 'current', label: 'Up to date', icon: 'check', test: (r) => r.state === 'current' },
    { id: 'unknown', label: 'Can’t tell', icon: 'info', test: (r) => r.state === 'unknown' },
    { id: 'failed', label: 'Couldn’t check', icon: 'alert', test: (r) => r.state === 'failed' },
];

/** How each state is drawn: the mark at the start of a row. */
const LOOK: Record<UpdateState, { icon: IconName; label: string }> = {
    major: { icon: 'update', label: 'A newer major version' },
    minor: { icon: 'update', label: 'A newer minor version' },
    patch: { icon: 'update', label: 'A newer patch' },
    rebuilt: { icon: 'digest', label: 'The tag points at a newer build' },
    current: { icon: 'check', label: 'Up to date' },
    unknown: { icon: 'info', label: 'Nothing to compare' },
    failed: { icon: 'alert', label: 'The registry could not be asked' },
    pending: { icon: 'clock', label: 'Asking the registry' },
};

const STEP_TONE: Record<UpdateKind, ChipTone> = { major: 'error', minor: 'warn', patch: 'info' };

interface State {
    ctx: K8sDockside.Context | null;
    inventory: Inventory | null;
    inventorySig: string;
    /** The registries' answers, by the inventory's key. */
    lookups: Map<string, K8sDockside.RegistryLookup>;
    report: UpdateReport | null;
    /** The report the list was last drawn from. */
    drawn: string;
    query: string;
    show: Show;
    namespace: string;
}

const hash = readHash();
const state: State = {
    ctx: null,
    inventory: null,
    inventorySig: '',
    lookups: new Map(),
    report: null,
    drawn: '',
    query: hash.q ?? '',
    show: SHOWS.some((s) => s.id === hash.show) ? (hash.show as Show) : 'all',
    namespace: hash.ns ?? '',
};

function remember(): void {
    writeHash({ q: state.query, show: state.show !== 'all' && state.show, ns: state.namespace });
}

function fail(err: unknown): void {
    banner.show(err);
}

// ----- asking the registries --------------------------------------------------------------

interface Question {
    key: string;
    image: string;
    ref: ImageRef;
    refresh: boolean;
}

const questions = {
    waiting: [] as Question[],
    /** Keys waiting or in flight, so an image is never asked twice at once. */
    open: new Set<string>(),
    inFlight: 0,
    /** This round: how many were asked, and how many have been answered. */
    total: 0,
    done: 0,
};

function asking(): boolean {
    return questions.inFlight > 0 || questions.waiting.length > 0;
}

/**
 * Asks about every row not asked yet -- or, with `refresh`, every row again.
 * Rows that share a repository are not merged: the app keeps a repository's
 * tag list, so the second question about it costs nothing.
 */
function ask(rows: readonly UpdateRow[], refresh: boolean): void {
    if (!asking()) {
        questions.total = 0;
        questions.done = 0;
    }
    for (const r of rows) {
        if (!r.ask || questions.open.has(r.key)) continue;
        if (!refresh && state.lookups.has(r.key)) continue;
        questions.open.add(r.key);
        questions.waiting.push({ key: r.key, image: r.ask, ref: r.entry.ref, refresh });
        questions.total++;
    }
    pump();
    drawHero();
}

function pump(): void {
    // Checked when the page starts: an app without it never gets this far.
    const registry = sdk.registry;
    if (!registry) return;
    while (questions.inFlight < IN_FLIGHT && questions.waiting.length) {
        const q = questions.waiting.shift()!;
        questions.inFlight++;
        registry
            .lookup({ image: q.image, refresh: q.refresh })
            // A refusal -- the pod running it went away, say -- is kept as a
            // failed answer, so the row says why instead of waiting forever.
            .catch((err: unknown) => refusedLookup(q.ref, q.image, message(err), new Date().toISOString()))
            .then((answer) => {
                state.lookups.set(q.key, answer);
            })
            .finally(() => {
                questions.inFlight--;
                questions.open.delete(q.key);
                questions.done++;
                rebuild();
                pump();
            });
    }
}

// ----- opening things -------------------------------------------------------------------------

function openWorkload(w: WorkloadRef, usage: Usage): void {
    if (w.appKind) {
        sdk.open({ kind: w.appKind, namespace: w.namespace, name: w.name }).catch(fail);
        return;
    }
    // An owner the app has no tab for (a custom resource): its first pod.
    const pod = usage.pods.find((p) => !p.finished) ?? usage.pods[0];
    if (pod) sdk.open({ kind: 'pods', namespace: pod.namespace, name: pod.pod }).catch(fail);
}

// ----- which rows are shown ---------------------------------------------------------------------

function inNamespace(r: UpdateRow): boolean {
    return !state.namespace || r.namespaces.includes(state.namespace);
}

function matchesQuery(r: UpdateRow): boolean {
    const q = state.query.trim().toLowerCase();
    if (!q) return true;
    const hay = [r.key, familiar(r.entry.ref), r.tag, r.registryLabel, ...r.entry.spellings, ...r.namespaces];
    for (const step of [r.updates.patch, r.updates.minor, r.updates.major, r.newest]) if (step) hay.push(step);
    for (const w of r.workloads) hay.push(w.workload.name);
    return q.split(/\s+/).every((word) => hay.some((h) => h.toLowerCase().includes(word)));
}

/** Rows in scope: the namespace and the search, before the state filter. */
function scoped(report: UpdateReport): UpdateRow[] {
    return report.rows.filter((r) => inNamespace(r) && matchesQuery(r));
}

// ----- the verdict -----------------------------------------------------------------------------

function strong(text: string | number, className = ''): HTMLElement {
    return el('strong', className, String(text));
}

function headline(s: UpdateSummary, busy: boolean): string {
    if (s.updates) return `${s.updates} of ${plural(s.images, 'image')} ${s.updates === 1 ? 'has an update' : 'have updates'}`;
    if (busy) return s.answered ? 'No updates so far' : `Checking ${plural(s.askable, 'image')}…`;
    if (!s.askable) return `${plural(s.images, 'image')}, all pinned by digest`;
    if (s.counts.current === s.images) return s.images === 1 ? 'The one image is up to date' : `All ${s.images} images are up to date`;
    return `No updates found for ${plural(s.images, 'image')}`;
}

/** The sentence under the headline, with the numbers in bold. */
function drawVerdict(p: HTMLElement, s: UpdateSummary): void {
    clear(p);
    const c = s.counts;
    const steps: Child[][] = [];
    if (c.major) steps.push([strong(c.major, 'bad'), ' major']);
    if (c.minor) steps.push([strong(c.minor, 'warnish'), ' minor']);
    if (c.patch) steps.push([strong(c.patch), ' patch']);
    if (c.rebuilt) steps.push([strong(c.rebuilt), ' rebuilt']);
    steps.forEach((step, i) => {
        if (i > 0) add(p, i === steps.length - 1 ? ' and ' : ', ');
        add(p, ...step);
    });
    if (steps.length) add(p, ', in ', strong(plural(s.containers, 'container')), ' across ', strong(plural(s.workloads, 'workload')), '. ');
    const alsoPushed = s.repushed - c.rebuilt;
    if (alsoPushed > 0) {
        add(p, strong(alsoPushed), ` with a newer version ${alsoPushed === 1 ? 'was' : 'were'} also pushed again since ${alsoPushed === 1 ? 'its' : 'their'} pods pulled ${alsoPushed === 1 ? 'it' : 'them'}. `);
    }
    if (c.failed) {
        const why = s.commonFailure;
        add(p, strong(c.failed, 'warnish'), ' couldn’t be checked');
        if (why) add(p, why.count < c.failed ? `, mostly because ${why.gist} (${why.count})` : `: ${why.gist}`);
        add(p, '. ');
    }
    if (c.unknown) {
        add(p, strong(c.unknown), ` ${c.unknown === 1 ? 'has' : 'have'} nothing to compare: a tag that is not a version with no build to check, or a digest with no tag. `);
    }
    if (!s.answered && s.askable) {
        add(p, 'The app asks each image’s registry which tags it has — anonymously, so private images cannot be checked.');
    } else if (!steps.length && !c.failed && !c.unknown && !c.pending) {
        add(p, 'Every version tag is the newest of its kind, and every other tag still points at the build its pods run.');
    }
}

function drawProgress(p: HTMLElement, s: UpdateSummary, busy: boolean): void {
    clear(p);
    p.hidden = false;
    if (busy) {
        add(p, el('span', 'pulse'), el('span', '', `Asked the registries about ${questions.done} of ${plural(questions.total, 'image')}…`));
        return;
    }
    if (!s.answered) {
        p.hidden = true;
        return;
    }
    const oldest = ago(s.oldestAnswer);
    add(p, icon('clock'), el('span', '', `Checked ${plural(s.answered, 'image')}` + (oldest ? ` · oldest answer ${oldest}` : '') + ' · the app keeps an answer for about half an hour'));
}

function drawHero(): void {
    const report = state.report;
    if (!report) return;
    const s = report.summary;
    const busy = asking();
    const everythingCurrent = s.images > 0 && s.counts.current === s.images;
    byId('hero').className = 'ov-hero up-hero ' + (s.updates ? 'warn' : busy ? 'busy' : everythingCurrent ? 'ok' : 'muted');
    const h = byId('headline');
    clear(h);
    add(h, icon(s.updates ? 'update' : busy ? 'clock' : everythingCurrent ? 'check' : 'info'), el('span', '', headline(s, busy)));
    drawVerdict(byId('verdict'), s);
    drawProgress(byId('progress'), s, busy);
    byId<HTMLButtonElement>('again').disabled = busy || !s.askable;
}

// ----- the filters -------------------------------------------------------------------------------

function setShow(show: Show): void {
    state.show = show;
    remember();
    keepFocus(byId('body'), drawBody);
}

function drawFilters(report: UpdateReport): void {
    const nav = byId('filters');
    clear(nav);
    const inScope = scoped(report);
    for (const s of SHOWS) {
        const n = inScope.filter(s.test).length;
        const on = state.show === s.id;
        const b = button('', `filter ${s.id}` + (on ? ' on' : '') + (n ? '' : ' zero'), s.icon, () => setShow(s.id));
        b.dataset.focus = 'show:' + s.id;
        b.setAttribute('aria-pressed', String(on));
        add(b, el('span', 'filter-label', s.label), el('span', 'filter-count', String(n)));
        nav.appendChild(b);
    }
}

// ----- one row ------------------------------------------------------------------------------------

function usedBy(r: UpdateRow): HTMLElement {
    const line = el('span', 'tag-used');
    const list = r.workloads.filter((w) => !state.namespace || w.workload.namespace === state.namespace);
    for (const w of list.slice(0, WORKLOADS_SHOWN)) {
        const b = workloadButton(w.workload, (x) => openWorkload(x, w.usage), { detail: `×${w.running}` });
        b.dataset.focus = 'wl:' + r.key + '|' + w.workload.key;
        line.appendChild(b);
    }
    if (list.length > WORKLOADS_SHOWN) line.appendChild(el('span', 'faint small', `+${list.length - WORKLOADS_SHOWN} more`));
    return line;
}

function registryLabel(r: UpdateRow): HTMLElement {
    const node = el('span', 'up-reg');
    const group = state.inventory?.registries.find((g) => g.registry === r.entry.ref.registry);
    add(node, swatch(group?.colour ?? 7), el('span', '', r.registryLabel));
    node.title = r.entry.ref.registry;
    return node;
}

function stateChips(r: UpdateRow): HTMLElement {
    const chips = el('span', 'tag-chips');
    const repo = familiarRepository(r.entry.ref);
    for (const kind of ['patch', 'minor', 'major'] as const) {
        const tag = r.updates[kind];
        if (tag) chips.appendChild(chip(`${kind} ${tag}`, STEP_TONE[kind], 'update', `A newer ${kind} version: ${repo}:${tag}`));
    }
    if (r.repushed) {
        chips.appendChild(
            chip(r.state === 'rebuilt' ? 'rebuilt' : 'pushed again', 'info', 'digest', `:${r.tag} now points at a build ${plural(r.behind, 'container')} here ${r.behind === 1 ? 'does' : 'do'} not run`),
        );
    }
    if (r.newest) chips.appendChild(chip(`newest version ${r.newest}`, 'muted', 'tag', `The newest release in ${repo}. :${r.tag} is not a version, so it is not compared with it.`));
    const failed = r.lookup && r.lookup.status !== 'ok' ? r.lookup.status : null;
    if (r.state === 'current') chips.appendChild(chip('up to date', 'ok', 'check'));
    else if (failed) chips.appendChild(chip(FAILURE_LABEL[failed], 'muted', 'alert', r.reason));
    else if (r.state === 'unknown') chips.appendChild(chip('can’t tell', 'muted', 'info', r.note));
    else if (r.state === 'pending') chips.appendChild(chip('asking…', 'muted', 'clock'));
    return chips;
}

function digestCode(digest: string): HTMLElement {
    const node = el('code', '', shortDigest(digest));
    node.title = digest;
    return node;
}

/** The line under a row: why it failed, which builds are behind, what else to know. `null` when there is nothing to say. */
function footOf(r: UpdateRow): HTMLElement | null {
    const text = el('span', 'up-foot-text');
    if (r.reason) text.appendChild(el('span', 'up-reason', r.reason));
    if (r.repushed && r.lookup) {
        const stale = r.staleDigests.slice(0, 2);
        add(text, text.childNodes.length ? ' ' : null, `:${r.tag} now points at `, digestCode(r.lookup.digest), `; ${plural(r.behind, 'container')} ${r.behind === 1 ? 'runs' : 'run'} `);
        stale.forEach((d, i) => add(text, i ? ', ' : '', digestCode(d)));
        if (r.staleDigests.length > stale.length) add(text, ` and ${r.staleDigests.length - stale.length} more`);
        add(text, '.');
        text.title = 'A pod runs the new build once its node pulls the tag again: when the pod starts with imagePullPolicy Always (the default for :latest), or on a node that does not have the old build.';
    }
    if (r.note) add(text, text.childNodes.length ? ' ' : null, r.note);
    if (!text.childNodes.length) return null;
    return add(el('div', 'up-foot'), text);
}

function rowOf(r: UpdateRow): HTMLElement {
    const node = el('article', 'tag-row up-row ' + r.state);
    const head = el('div', 'tag-head');

    const mark = el('span', 'up-mark ' + r.state);
    mark.appendChild(icon(LOOK[r.state].icon));
    const checked = r.lookup ? ago(Date.parse(r.lookup.checkedAt)) : '';
    mark.title = LOOK[r.state].label + (checked ? ` · checked ${checked}` : '');

    const name = el('code', 'repo-name', familiarRepository(r.entry.ref));
    name.title = r.key;

    const right = el('span', 'tag-right');
    add(right, usedBy(r), registryLabel(r));
    const page = tagsPage(r.entry.ref);
    if (page) {
        const link = iconButton('open', page.label, () => sdk.openUrl(page.url).catch(fail));
        link.dataset.focus = 'tags:' + r.key;
        right.appendChild(link);
    }

    add(head, mark, name, tagPill(r.entry), stateChips(r), right);
    node.appendChild(head);
    const foot = footOf(r);
    if (foot) node.appendChild(foot);
    return node;
}

// ----- the list ----------------------------------------------------------------------------------

function clearFilters(): void {
    state.query = '';
    state.show = 'all';
    state.namespace = '';
    byId<HTMLInputElement>('query').value = '';
    byId<HTMLSelectElement>('namespace').value = '';
    remember();
    keepFocus(byId('body'), drawBody);
}

function nothingShown(): HTMLElement {
    const none = el('div', 'none');
    const label = SHOWS.find((s) => s.id === state.show)?.label ?? '';
    const where = [state.query ? `“${state.query}”` : '', state.namespace ? `in ${state.namespace}` : ''].filter(Boolean).join(' ');
    const text = state.show === 'all' ? `No image matches ${where}.` : `Nothing under ${label}${where ? ' matches ' + where : ''}.`;
    add(none, icon('search'), el('p', '', text));
    none.appendChild(button('Clear filters', 'ghost small', 'close', clearFilters));
    return none;
}

function drawList(report: UpdateReport): void {
    const list = byId('list');
    clear(list);
    const test = SHOWS.find((s) => s.id === state.show)?.test ?? (() => true);
    const shown = scoped(report).filter(test);
    if (!shown.length) {
        list.appendChild(nothingShown());
        return;
    }
    for (const r of shown) list.appendChild(rowOf(r));
}

function drawBody(): void {
    const report = state.report;
    if (!report) return;
    drawFilters(report);
    drawList(report);
}

// An answer's redraw waits while the user is pressing, selecting or typing in the list.
const redrawBody = politely(byId('body'), drawBody);

// ----- the frame ---------------------------------------------------------------------------------

function drawWhere(): void {
    const parts = [state.ctx?.contextName ?? ''];
    const s = state.report?.summary;
    if (s) parts.push(plural(s.images, 'image'));
    if (s && s.updates) parts.push(`${s.updates} with updates`);
    byId('where').textContent = parts.filter(Boolean).join(' · ');
}

function drawNamespaces(): void {
    const select = byId<HTMLSelectElement>('namespace');
    // Leave it alone while it is open or focused: rebuilding it would close it.
    if (document.activeElement === select) return;
    const rows = state.report?.rows ?? [];
    const counts = new Map<string, number>();
    for (const r of rows) for (const ns of r.namespaces) counts.set(ns, (counts.get(ns) ?? 0) + 1);
    const names = [...new Set([...counts.keys(), ...(state.namespace ? [state.namespace] : [])])].sort();
    const want = [String(rows.length), ...names.map((ns) => `${ns}:${counts.get(ns) ?? 0}`)].join('|');
    if (select.dataset.options === want) return;
    select.dataset.options = want;
    clear(select);
    const anywhere = el('option', '', `Every namespace (${rows.length})`);
    anywhere.value = '';
    select.appendChild(anywhere);
    for (const ns of names) {
        const option = el('option', '', `${ns} (${counts.get(ns) ?? 0})`);
        option.value = ns;
        select.appendChild(option);
    }
    select.value = state.namespace;
}

/** The search and the namespace picker, which mean something only beside a list. */
function showControls(show: boolean): void {
    byId('search').hidden = !show;
    byId('ns-pick').hidden = !show;
}

/** A page in place of the list: nothing runs, or the app cannot ask registries for this plugin. */
function drawInstead(title: string, ...text: Child[]): void {
    byId('main').hidden = true;
    showControls(false);
    const empty = byId('empty');
    empty.hidden = false;
    clear(empty);
    const art = el('div', 'empty-art');
    art.appendChild(icon('update'));
    add(empty, art, el('h2', '', title), add(el('p', 'faint'), ...text));
}

function drawAll(): void {
    const report = state.report;
    drawWhere();
    if (!report) return;
    if (!report.rows.length) {
        drawInstead('Nothing running to check', 'No pod in this cluster runs a container right now. Once one does, its image is looked up here within a few seconds.');
        return;
    }
    byId('empty').hidden = true;
    byId('main').hidden = false;
    showControls(true);
    drawNamespaces();
    drawHero();
    if (report.signature === state.drawn) return;
    state.drawn = report.signature;
    redrawBody();
}

let drawTimer: ReturnType<typeof setTimeout> | undefined;

/** Builds the rows again from what is known, and draws them soon: answers come in bursts, and one drawing takes in several. */
function rebuild(): void {
    if (!state.inventory) return;
    state.report = buildUpdates(state.inventory, state.lookups);
    if (drawTimer !== undefined) return;
    drawTimer = setTimeout(() => {
        drawTimer = undefined;
        drawAll();
    }, DRAW_AFTER);
}

// ----- wiring ---------------------------------------------------------------------------------------

byId('logo').appendChild(icon('logo'));
byId('search-icon').appendChild(icon('search'));

const query = byId<HTMLInputElement>('query');
query.value = state.query;
query.addEventListener('input', () => {
    state.query = query.value;
    remember();
    drawBody();
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
    drawBody();
    nsSelect.blur();
});

const again = byId<HTMLButtonElement>('again');
add(again, icon('restart'), el('span', '', 'Check again'));
again.title = 'Ask every registry again, rather than use the answers the app kept from the last half hour';
again.addEventListener('click', () => {
    if (state.report && !asking()) ask(state.report.rows, true);
});

function onFeed(feed: FeedState): void {
    if (feed.errors.pods) banner.show(feed.errors.pods);
    else banner.clear();
    if (!feed.ready) return;
    const inv = buildInventory(feed.data);
    if (inv.signature === state.inventorySig) return;
    const first = !state.inventory;
    state.inventory = inv;
    state.inventorySig = inv.signature;
    rebuild();
    if (first) drawAll();
    // A new image is asked about as soon as it shows up; the rest already were.
    if (state.report) ask(state.report.rows, false);
}

sdk.ready()
    .then((ctx) => {
        state.ctx = ctx;
        drawWhere();
        // An app older than 0.0.25 has no registry calls at all; a newer one
        // answers them only for a plugin that declares it asks.
        if (typeof sdk.registry?.lookup !== 'function') {
            drawInstead(
                'Updates needs K8s Dockside 0.0.25 or newer',
                'This page asks each image’s registry which tags it has, and only the app can do that on its behalf — this version of the app cannot yet. Update K8s Dockside to see which images have newer versions; the Overview and Images pages work as they are.',
            );
            return;
        }
        if (!ctx.registries) {
            drawInstead(
                'This plugin does not ask to look up registries',
                'The app asks an image’s registry only for a plugin whose plugin.json says ',
                el('code', '', '"ui": { "registries": true }'),
                '. Add it, then press Reload in Settings → Plugins.',
            );
            return;
        }
        startFeed(sdk, { fast: PODS_EVERY, slow: OWNERS_EVERY, onChange: onFeed });
    })
    .catch(fail);
