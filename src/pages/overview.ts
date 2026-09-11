// Image inventory's own overview, in place of the page the app generates.
//
// It answers first what the generated page would -- is the cluster even
// answering? (`summary()`) -- and then what that page cannot: how many images
// the cluster runs and from where (a ring of registries), which of them are
// risky and why (pull failures in plain words, containers not ready, one tag
// running two builds, tags that float), which images and namespaces use the
// most, and -- from Prometheus, when there is one -- image pulls over the day
// (`charts()`).
//
// Bridge calls used here: ready, watch (through the feed), summary, charts,
// open, openView, openUrl, on('theme').

import { startFeed, type FeedKind, type FeedState } from '../model/feed';
import { buildInventory, fingerprint, type ImageEntry, type Inventory, type Tone, type WorkloadRef } from '../model/inventory';
import { lineChart, ring, type SeriesColour } from '../ui/charts';
import { add, button, byId, chip, clear, el, icon, linkButton } from '../ui/dom';
import { percent, plural, words } from '../ui/format';
import type { IconName } from '../ui/icons';
import { banner, every, politely, sdk } from '../ui/page';
import { diagnosisBox, imageName, issueChips, readiness, registryColour, swatch, workloadButton } from '../ui/widgets';

const SUMMARY_EVERY = 30_000;
const CHARTS_EVERY = 60_000;
const HISTORY_MINUTES = 24 * 60;
const ATTENTION_ROWS = 8;
const RING_SLICES = 7;
const DOCS = 'https://kubernetes.io/docs/concepts/containers/images/';

interface State {
    ctx: K8sDockside.Context | null;
    feed: FeedState | null;
    inventory: Inventory | null;
    summary: K8sDockside.Summary | null;
    panel: K8sDockside.ChartsPanel | null;
    sig: string;
    allAttention: boolean;
}

const state: State = { ctx: null, feed: null, inventory: null, summary: null, panel: null, sig: '', allAttention: false };

function fail(err: unknown): void {
    banner.show(err);
}

function open(w: WorkloadRef, entry?: ImageEntry): void {
    if (w.appKind) {
        sdk.open({ kind: w.appKind, namespace: w.namespace, name: w.name }).catch(fail);
        return;
    }
    // An owner the app has no tab for (a custom resource): its first pod.
    const pod = entry?.usages.find((u) => u.workload.key === w.key)?.pods[0];
    if (pod) sdk.open({ kind: 'pods', namespace: pod.namespace, name: pod.pod }).catch(fail);
}

function openImages(): void {
    sdk.openView('images').catch(fail);
}

function openUrl(url: string): void {
    sdk.openUrl(url).catch(fail);
}

function strong(text: string | number, className = ''): HTMLElement {
    return el('strong', className, String(text));
}

// ----- the hero ------------------------------------------------------------------

interface Verdict {
    tone: Tone;
    icon: IconName;
    status: string;
}

function verdict(inv: Inventory): Verdict {
    const t = inv.totals;
    if (t.pullFailing) return { tone: 'error', icon: 'failed', status: `${plural(t.pullFailing, 'image is', 'images are')} failing to pull` };
    if (t.notReady || t.drift) {
        const parts = [];
        if (t.notReady) parts.push(`${plural(t.notReady, 'image has', 'images have')} containers not ready`);
        if (t.drift) parts.push(`${plural(t.drift, 'tag runs', 'tags run')} two builds`);
        return { tone: 'warn', icon: 'alert', status: words(parts) };
    }
    if (t.floating) return { tone: 'warn', icon: 'moving', status: `Everything pulls — ${plural(t.floating, 'image floats', 'images float')} on a moving tag` };
    return { tone: 'ok', icon: 'check', status: 'Every image pulls, runs and is tagged' };
}

function headline(inv: Inventory): string {
    const t = inv.totals;
    return `${plural(t.images, 'image')} from ${plural(t.registries, 'registry', 'registries')} across ${plural(t.namespaces, 'namespace')}`;
}

/** The sentence under the verdict, with the numbers in bold. */
function story(inv: Inventory): HTMLElement {
    const t = inv.totals;
    const p = el('p', 'ov-story');
    add(p, strong(plural(t.containers, 'container')), ' in ', strong(plural(t.pods, 'pod')), ` run ${t.running === t.images ? 'them' : `${t.running} of them`}`);
    if (t.idle) add(p, '; ', strong(t.idle), ` ${t.idle === 1 ? 'is' : 'are'} declared by a workload but not running right now`);
    add(p, '. ');

    const parts: HTMLElement[][] = [];
    if (t.pullFailing) parts.push([strong(t.pullFailing, 'bad'), el('span', '', ` can’t be pulled`)]);
    if (t.notReady) parts.push([strong(t.notReady, 'warnish'), el('span', '', ` ${t.notReady === 1 ? 'has' : 'have'} containers that are not ready`)]);
    if (t.drift) parts.push([strong(t.drift, 'warnish'), el('span', '', ` ${t.drift === 1 ? 'runs' : 'run'} two builds of one tag`)]);
    if (t.floating) parts.push([strong(t.floating, 'warnish'), el('span', '', ` float on :latest or another moving tag`)]);
    parts.forEach((part, i) => {
        if (i > 0) add(p, i === parts.length - 1 ? ' and ' : ', ');
        add(p, ...part);
    });
    if (parts.length) add(p, '. ');
    add(p, strong(`${t.pinned} of ${t.images}`, t.pinned ? 'ok' : ''), t.pinned === 1 ? ' is' : ' are', ' pinned by digest.');
    return p;
}

function registryRing(inv: Inventory): HTMLElement {
    const side = el('div', 'ov-hero-side');
    const groups = inv.registries;
    const shown = groups.slice(0, RING_SLICES);
    const rest = groups.slice(RING_SLICES);
    const slices = shown.map((g) => ({ value: g.images, colour: registryColour(g.colour), title: `${g.label}: ${plural(g.images, 'image')}` }));
    if (rest.length) {
        slices.push({ value: rest.reduce((n, g) => n + g.images, 0), colour: registryColour(7), title: `${plural(rest.length, 'other registry', 'other registries')}` });
    }
    const centre = el('div', 'ring-text');
    add(centre, el('div', 'ring-big', String(inv.totals.registries)), el('div', 'ring-small', inv.totals.registries === 1 ? 'registry' : 'registries'));
    side.appendChild(ring(slices, centre, { label: `Images by registry: ${shown.map((g) => `${g.label} ${g.images}`).join(', ')}` }));

    const legend = el('div', 'reg-legend');
    legend.appendChild(el('div', 'mini-title', 'Where the images come from'));
    for (const g of shown) {
        const row = button('', 'reg-row', null, openImages);
        row.title = `${g.registry}: ${plural(g.images, 'image')}, ${plural(g.containers, 'container')} — open Images`;
        const names = el('span', 'reg-names');
        add(names, el('span', 'reg-label', g.label), g.label !== g.registry ? el('span', 'reg-host', g.registry) : null);
        const share = el('span', 'reg-share');
        const fill = el('i');
        fill.style.width = percent(g.images, inv.totals.images);
        fill.style.background = registryColour(g.colour);
        share.appendChild(fill);
        add(row, swatch(g.colour), names, g.frozen ? chip('frozen', 'warn', 'snowflake', `${g.registry} gets no new images; move to registry.k8s.io`) : null, share, el('span', 'reg-count', String(g.images)));
        legend.appendChild(row);
    }
    if (rest.length) {
        const more = button('', 'reg-row more', null, openImages);
        add(more, swatch(7), el('span', 'reg-names', `and ${plural(rest.length, 'more registry', 'more registries')}`), el('span', 'reg-share'), el('span', 'reg-count', String(rest.reduce((n, g) => n + g.images, 0))));
        legend.appendChild(more);
    }
    side.appendChild(legend);
    return side;
}

function eyebrow(): HTMLElement {
    const node = el('div', 'ov-eyebrow');
    const logo = el('span', 'logo');
    logo.appendChild(icon('logo'));
    add(node, logo, el('span', '', 'Image inventory'), el('span', 'faint', '· ' + (state.ctx?.contextName ?? '')));
    return node;
}

function drawHero(inv: Inventory): void {
    const hero = byId('hero');
    clear(hero);
    const v = verdict(inv);
    hero.className = 'ov-hero ' + v.tone;

    const main = el('div', 'ov-hero-main');
    main.appendChild(eyebrow());
    const h1 = el('h1', 'ov-verdict');
    add(h1, icon(v.icon), el('span', '', headline(inv)));
    main.appendChild(h1);
    const status = el('p', 'ov-status ' + v.tone);
    add(status, el('i', 'sdot ' + v.tone), el('span', '', v.status));
    main.appendChild(status);
    main.appendChild(story(inv));
    const cta = el('div', 'ov-cta');
    add(
        cta,
        button('Browse images', 'primary', 'grid', openImages),
        button('Pods', 'ghost', 'pod', () => sdk.open({ kind: 'pods' }).catch(fail)),
        button('About image references', 'ghost', 'book', () => openUrl(DOCS + '#image-names')),
    );
    main.appendChild(cta);
    hero.appendChild(main);
    hero.appendChild(registryRing(inv));
}

// ----- the numbers -------------------------------------------------------------------

function tile(label: string, value: string, sub: string, tone: Tone | '', iconName: IconName, extra?: HTMLElement): HTMLElement {
    const node = el('div', 'stat' + (tone ? ' ' + tone : ''));
    const top = el('div', 'stat-top');
    add(top, icon(iconName), el('span', '', label));
    add(node, top, el('div', 'stat-value', value), extra ?? null, el('div', 'stat-sub', sub));
    return node;
}

function drawStats(inv: Inventory): void {
    const box = byId('stats');
    clear(box);
    box.hidden = false;
    const t = inv.totals;
    const pinnedMeter = el('div', 'stat-meter');
    const fill = el('i');
    fill.style.width = percent(t.pinned, t.images);
    pinnedMeter.appendChild(fill);
    add(
        box,
        tile('Images', String(t.images), t.idle ? `${t.running} running · ${t.idle} declared only` : 'all of them running', '', 'logo'),
        tile('Containers', String(t.containers), `in ${plural(t.pods, 'pod')}`, '', 'container'),
        tile('Pinned by digest', percent(t.pinned, t.images), `${t.pinned} of ${plural(t.images, 'image')}`, t.pinned === t.images && t.images ? 'ok' : '', 'lock', pinnedMeter),
        tile('Floating tags', String(t.floating), t.floating ? ':latest, untagged or moving' : 'none', t.floating ? 'warn' : 'ok', 'moving'),
        tile('Pull failures', String(t.pullFailing), t.pullFailing ? `${plural(t.pullContainers, 'container')} waiting for an image` : 'every image pulls', t.pullFailing ? 'error' : 'ok', 'failed'),
    );
}

// ----- what needs attention -----------------------------------------------------------

function attentionRow(entry: ImageEntry): HTMLElement {
    const row = el('article', 'att ' + entry.tone);
    const top = el('div', 'att-top');
    const mark = el('span', 'att-mark ' + entry.tone);
    mark.appendChild(icon(entry.tone === 'error' ? 'failed' : 'alert'));
    const chips = el('span', 'att-chips');
    add(chips, ...issueChips(entry, { idle: false }));
    add(top, mark, imageName(entry), chips, entry.containers ? readiness(entry.ready, entry.containers, entry.pulling) : null);
    row.appendChild(top);

    const worst = entry.issues[0];
    if (worst) {
        if (worst.diagnosis) {
            row.appendChild(el('p', 'att-text', worst.text));
            const box = diagnosisBox(worst);
            if (box) row.appendChild(box);
        } else {
            row.appendChild(el('p', 'att-text', worst.text));
        }
    }

    const used = el('div', 'att-used');
    used.appendChild(el('span', 'mini-title', 'Used by'));
    const workloads = [...new Map(entry.usages.map((u) => [u.workload.key, u.workload])).values()];
    for (const w of workloads.slice(0, 4)) used.appendChild(workloadButton(w, (x) => open(x, entry)));
    if (workloads.length > 4) used.appendChild(el('span', 'faint small', `+${workloads.length - 4} more`));
    row.appendChild(used);
    return row;
}

function drawAttention(inv: Inventory): void {
    const box = byId('attention');
    clear(box);
    box.hidden = false;
    const list = inv.images.filter((i) => i.tone === 'error' || i.tone === 'warn');
    const bad = list.filter((i) => i.tone === 'error').length;
    box.className = 'card attention' + (bad ? ' has-error' : list.length ? ' has-warn' : ' clear');

    const head = el('div', 'card-head');
    add(head, icon(list.length ? 'alert' : 'check'), el('h2', '', 'Needs attention'));
    if (list.length) head.appendChild(el('span', 'count ' + (bad ? 'error' : 'warn'), String(list.length)));
    head.appendChild(el('span', 'card-sub', list.length ? 'Images failing to pull, with containers not ready, running two builds of one tag, or floating on a tag that moves — worst first.' : ''));
    box.appendChild(head);

    if (!list.length) {
        const ok = el('div', 'all-clear');
        add(ok, icon('check'), el('span', '', 'Nothing needs attention: every image pulls, its containers are ready, and nothing floats on :latest.'));
        box.appendChild(ok);
        return;
    }
    const rows = el('div', 'att-list');
    const shown = state.allAttention ? list : list.slice(0, ATTENTION_ROWS);
    for (const entry of shown) rows.appendChild(attentionRow(entry));
    box.appendChild(rows);
    if (list.length > ATTENTION_ROWS) {
        const more = button(state.allAttention ? `Show the first ${ATTENTION_ROWS}` : `Show all ${list.length}`, 'ghost small', 'chevron-down', () => {
            state.allAttention = !state.allAttention;
            drawAttention(inv);
        });
        more.dataset.focus = 'att-more';
        box.appendChild(more);
    }
}

// ----- the biggest users -----------------------------------------------------------------

function drawTop(inv: Inventory): void {
    const box = byId('top');
    clear(box);
    const head = el('div', 'card-head');
    add(head, icon('rank'), el('h2', '', 'Most-run images'));
    const all = button('Browse all', 'ghost small push', 'grid', openImages);
    head.appendChild(all);
    box.appendChild(head);
    const top = inv.images
        .filter((i) => i.containers > 0)
        .sort((a, b) => b.containers - a.containers || a.key.localeCompare(b.key))
        .slice(0, 10);
    if (!top.length) {
        box.appendChild(el('p', 'quiet', 'Nothing is running.'));
        return;
    }
    const max = top[0]!.containers;
    const list = el('ol', 'bars');
    for (const entry of top) {
        const li = el('li', 'bar-row');
        const registry = inv.registries.find((g) => g.registry === entry.ref.registry);
        const track = el('span', 'bar-track');
        const fill = el('i', 'bar-fill');
        fill.style.width = `${Math.max(3, (entry.containers / max) * 100)}%`;
        track.appendChild(fill);
        const workloads = new Set(entry.usages.map((u) => u.workload.key)).size;
        const label = el('div', 'bar-label');
        // The registry's colour as a swatch, not as the bar: a bar in the
        // chart palette's amber or green would read as a warning or an ok.
        add(label, swatch(registry?.colour ?? 7), imageName(entry), el('span', 'bar-note', `${plural(entry.containers, 'container')} · ${plural(workloads, 'workload')}`));
        add(li, label, track);
        li.title = `${entry.key}\n${registry?.label ?? entry.ref.registry}`;
        list.appendChild(li);
    }
    box.appendChild(list);
}

function drawUsers(inv: Inventory): void {
    const box = byId('users');
    clear(box);
    const head = el('div', 'card-head');
    add(head, icon('users'), el('h2', '', 'Biggest users'), el('span', 'card-sub', 'Namespaces by how many different images they run.'));
    box.appendChild(head);
    const top = inv.namespaces.slice(0, 7);
    if (!top.length) {
        box.appendChild(el('p', 'quiet', 'No namespace runs anything yet.'));
        return;
    }
    const max = top[0]!.images;
    const list = el('ol', 'users');
    for (const ns of top) {
        const li = el('li', 'user-row');
        const line = el('div', 'user-line');
        const name = el('span', 'user-ns');
        add(name, el('i', 'sdot ' + (ns.tone === 'ok' ? 'ok' : ns.tone)), el('span', '', ns.namespace || '(cluster)'));
        const track = el('span', 'bar-track');
        const fill = el('i', 'bar-fill ns');
        fill.style.width = `${Math.max(3, (ns.images / max) * 100)}%`;
        track.appendChild(fill);
        add(line, name, track, el('span', 'user-count', `${plural(ns.images, 'image')} · ${plural(ns.containers, 'container')}`));
        line.title = `${ns.namespace}: ${plural(ns.images, 'image')}, ${plural(ns.containers, 'container')}, ${plural(ns.workloads.length, 'workload')}`;
        li.appendChild(line);
        const ws = el('div', 'user-workloads');
        for (const w of ns.workloads.slice(0, 3)) ws.appendChild(workloadButton(w.workload, (x) => open(x, inv.images.find((i) => i.usages.some((u) => u.workload.key === x.key))), { namespace: false, detail: plural(w.images, 'image') }));
        if (ns.workloads.length > 3) ws.appendChild(el('span', 'faint small', `+${ns.workloads.length - 3}`));
        li.appendChild(ws);
        list.appendChild(li);
    }
    box.appendChild(list);
}

// ----- history, from Prometheus ------------------------------------------------------------

const SERIES: Record<string, SeriesColour> = {
    pulls: { token: '--chart-1', fallback: '#3987e5' },
    failures: { token: '--error', fallback: '#f4787f' },
};

function seriesColour(name: string, index: number): SeriesColour {
    return SERIES[name] ?? { token: `--chart-${Math.min(index + 1, 8)}`, fallback: '#3987e5' };
}

function drawHistory(): void {
    const box = byId('history');
    clear(box);
    const panel = state.panel;
    box.hidden = !panel || !panel.attached || !state.inventory || !state.inventory.images.length;
    if (box.hidden || !panel) return;
    const head = el('div', 'section-head');
    add(head, icon('chart'), el('h2', '', `Over the last ${Math.round(panel.range / 60) || 24} hours`));
    if (panel.source.available && panel.source.describe) head.appendChild(el('span', 'card-sub', 'From Prometheus at ' + panel.source.describe));
    box.appendChild(head);
    if (!panel.source.available) {
        box.appendChild(
            el(
                'p',
                'quiet',
                'No Prometheus was found in this cluster, so there is no history to draw — everything above comes from the API server. ' +
                    (panel.source.error || 'If yours lives somewhere the app did not look, set its address in the cluster’s settings.'),
            ),
        );
        return;
    }
    const row = el('div', 'chart-row');
    for (const chart of panel.charts) row.appendChild(lineChart(chart, seriesColour));
    box.appendChild(row);
}

// ----- the foot --------------------------------------------------------------------------

const READ_KINDS: Partial<Record<FeedKind, string>> = {
    deployments: 'Deployments',
    statefulsets: 'StatefulSets',
    daemonsets: 'DaemonSets',
    replicasets: 'ReplicaSets',
    jobs: 'Jobs',
    cronjobs: 'CronJobs',
    events: 'Events',
};

function drawFoot(opts: { readErrors?: boolean } = {}): void {
    const box = byId('foot');
    clear(box);
    box.hidden = false;

    const go = el('div', 'go');
    add(
        go,
        button('Images', 'go-tile', 'grid', openImages),
        button('Pods', 'go-tile', 'pod', () => sdk.open({ kind: 'pods' }).catch(fail)),
        button('Deployments', 'go-tile', 'deployment', () => sdk.open({ kind: 'deployments' }).catch(fail)),
        button('StatefulSets', 'go-tile', 'statefulset', () => sdk.open({ kind: 'statefulsets' }).catch(fail)),
        button('DaemonSets', 'go-tile', 'daemonset', () => sdk.open({ kind: 'daemonsets' }).catch(fail)),
        button('CronJobs', 'go-tile', 'cronjob', () => sdk.open({ kind: 'cronjobs' }).catch(fail)),
    );
    box.appendChild(go);

    const summary = state.summary;
    const podsCard = summary?.cards.find((c) => c.kind === 'pods' && c.grouped);
    if (podsCard && podsCard.total) {
        const phases = el('div', 'reqs');
        phases.appendChild(el('span', 'reqs-label', 'Pods by phase'));
        for (const b of podsCard.buckets) {
            const tone = (['ok', 'warn', 'error', 'info'].includes(b.tone) ? b.tone : '') as 'ok' | 'warn' | 'error' | 'info' | '';
            phases.appendChild(chip(`${b.value || 'no status yet'} ${b.count}`, tone));
        }
        box.appendChild(phases);
    }
    if (summary && summary.requirements.length) {
        const reqs = el('div', 'reqs');
        reqs.appendChild(el('span', 'reqs-label', 'This cluster serves'));
        for (const r of summary.requirements) {
            const tone = r.error ? 'warn' : r.served ? 'ok' : r.optional ? 'muted' : 'error';
            reqs.appendChild(chip(r.label, tone, r.error ? 'alert' : r.served ? 'check' : 'close', r.error || r.kind));
        }
        box.appendChild(reqs);
    }

    // Which of the owners could not be read -- unless nothing could, which
    // the hero has already said in one sentence rather than seven.
    const errors = Object.entries(state.feed?.errors ?? {}).filter(([kind]) => kind !== 'pods');
    if (errors.length && opts.readErrors !== false) {
        const note = el('p', 'foot-note');
        note.appendChild(icon('info'));
        add(
            note,
            el(
                'span',
                '',
                `Could not read ${words(errors.map(([kind]) => READ_KINDS[kind as FeedKind] ?? kind))}, so pods are grouped as far up their owners as the rest allows. ` +
                    errors.map(([kind, msg]) => `${READ_KINDS[kind as FeedKind] ?? kind}: ${msg}`).join(' · '),
            ),
        );
        box.appendChild(note);
    }

    // What the plugin says about itself -- ready().plugin, which an app older
    // than the one that added it does not send.
    const plugin = state.ctx?.plugin;
    const about = el('div', 'about');
    const who = el('span', 'about-name');
    add(who, icon('logo'), el('span', '', plugin?.name || 'Image inventory'), plugin?.version ? el('span', 'about-version', 'v' + plugin.version) : null);
    about.appendChild(who);
    const links = [...(plugin?.links ?? [])];
    if (plugin?.docs && !links.some((l) => l.url === plugin.docs)) links.unshift({ label: 'Documentation', url: plugin.docs });
    for (const l of links) {
        const b = linkButton(l.label || l.url, () => openUrl(l.url), l.url);
        b.prepend(icon('open'));
        b.classList.add('about-link');
        about.appendChild(b);
    }
    box.appendChild(about);
}

// ----- not answering, or nothing to show ---------------------------------------------------------

function drawAbsent(kind: 'unreachable' | 'missing' | 'pods', detail: string): void {
    const hero = byId('hero');
    clear(hero);
    hero.className = 'ov-hero absent';
    for (const id of ['stats', 'attention', 'columns', 'history']) byId(id).hidden = true;
    const main = el('div', 'ov-hero-main');
    const art = el('div', 'empty-art');
    art.appendChild(icon('logo'));
    main.appendChild(art);
    const title = kind === 'unreachable' ? 'This cluster did not answer' : kind === 'pods' ? 'Pods could not be read' : `This cluster does not serve pods`;
    const text =
        kind === 'unreachable'
            ? 'Whether anything runs here could not be checked — which is not the same as nothing running. The page tries again on its own.'
            : kind === 'pods'
              ? 'Every image this page shows comes from the pods’ specs and statuses, so without them there is nothing to take stock of.'
              : 'Every Kubernetes cluster serves pods, so this is an API server that is not answering the usual way.';
    add(main, el('h1', 'ov-verdict', title), el('p', 'ov-story', text));
    if (detail) main.appendChild(el('code', 'absent-detail', detail));
    hero.appendChild(main);
    drawFoot({ readErrors: false });
}

function drawEmpty(): void {
    const hero = byId('hero');
    clear(hero);
    hero.className = 'ov-hero absent';
    for (const id of ['stats', 'attention', 'columns', 'history']) byId(id).hidden = true;
    const main = el('div', 'ov-hero-main');
    main.appendChild(eyebrow());
    const art = el('div', 'empty-art');
    art.appendChild(icon('logo'));
    main.appendChild(art);
    add(
        main,
        el('h1', 'ov-verdict', 'No containers yet'),
        el('p', 'ov-story', 'There are no pods or workloads in any namespace this cluster lets you list. Deploy something and its images appear here within a few seconds — with where they come from and whether they pull.'),
    );
    const cta = el('div', 'ov-cta');
    cta.appendChild(button('About container images', 'primary', 'book', () => openUrl(DOCS)));
    main.appendChild(cta);
    hero.appendChild(main);
    drawFoot();
}

// ----- putting it together --------------------------------------------------------------------------

function render(): void {
    const summary = state.summary;
    const feed = state.feed;
    if (summary && !summary.checked) return drawAbsent('unreachable', summary.error);
    if (summary && !summary.installed) return drawAbsent('missing', summary.requirements.filter((r) => !r.served && !r.optional).map((r) => r.kind).join(', '));
    if (feed && !feed.ready && feed.errors.pods) return drawAbsent('pods', feed.errors.pods);
    const inv = state.inventory;
    if (!inv) return;
    if (!inv.images.length) return drawEmpty();
    byId('columns').hidden = false;
    drawHero(inv);
    drawStats(inv);
    drawAttention(inv);
    drawTop(inv);
    drawUsers(inv);
    drawHistory();
    drawFoot();
}

const redraw = politely(document.body, render);

function onFeed(feed: FeedState): void {
    state.feed = feed;
    if (feed.ready && feed.errors.pods) banner.show(feed.errors.pods);
    else banner.clear();
    const inv = feed.ready ? buildInventory(feed.data) : null;
    const sig = (inv?.signature ?? 'none') + fingerprint(JSON.stringify(feed.errors));
    if (sig === state.sig) return;
    state.inventory = inv;
    state.sig = sig;
    redraw();
}

sdk.ready()
    .then((ctx) => {
        state.ctx = ctx;
        startFeed(sdk, { onChange: onFeed });
        every(SUMMARY_EVERY, async () => {
            const summary = await sdk.summary();
            const changed = JSON.stringify(summary) !== JSON.stringify(state.summary);
            state.summary = summary;
            if (changed) redraw();
        });
        every(CHARTS_EVERY, async () => {
            state.panel = await sdk.charts({ minutes: HISTORY_MINUTES });
            if (state.inventory) drawHistory();
        });
        // The chart fills take their colours from the theme as values, not
        // var()s (see tokenColour), so a new theme means drawing them again.
        sdk.on('theme', () => drawHistory());
    })
    .catch(fail);
