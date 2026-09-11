// The pieces every page draws an image with: its tag, its registry, its
// problems, the workloads using it.

import { familiar, shortDigest, type TagRisk } from '../model/image-ref';
import type { ImageEntry, Issue, PodUse, Tone, WorkloadRef } from '../model/inventory';
import { add, button, chip, el, icon, type ChipTone } from './dom';
import { kindIcon, type IconName } from './icons';
import { plural } from './format';

/** Fallbacks for the chart tokens, for a page opened on its own outside the app. */
const CHART_FALLBACK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

/** A registry's colour: --chart-1 … --chart-8 in registry order, the eighth and after sharing the last. */
export function registryColour(index: number): string {
    const i = Math.max(0, Math.min(index, 7));
    return `var(--chart-${i + 1}, ${CHART_FALLBACK[i]})`;
}

export function registryTile(colour: number, className = ''): HTMLSpanElement {
    const tile = el('span', 'rtile' + (className ? ' ' + className : ''));
    tile.style.setProperty('--tone', registryColour(colour));
    tile.appendChild(icon('registry'));
    return tile;
}

export function swatch(colour: number): HTMLElement {
    const node = el('i', 'swatch');
    node.style.background = registryColour(colour);
    return node;
}

const RISK_ICON: Record<TagRisk, IconName> = { pinned: 'lock', tagged: 'tag', floating: 'moving', latest: 'moving', implicit: 'alert' };

/** The tag as the thing to read first about an image: how firmly it says which build runs. */
export function tagPill(entry: ImageEntry): HTMLElement {
    const { ref, risk } = entry;
    const floating = risk === 'latest' || risk === 'implicit' || risk === 'floating';
    const node = el('span', 'tagpill ' + (risk === 'pinned' ? 'pinned' : floating ? 'floating' : 'tagged'));
    node.appendChild(icon(RISK_ICON[risk]));
    let text: string;
    if (!ref.valid) text = ref.raw.trim() || '(empty)';
    else if (risk === 'implicit') text = 'latest (untagged)';
    else if (ref.tag && ref.digest) text = `${ref.tag} @ ${shortDigest(ref.digest)}`;
    else if (ref.digest) text = '@' + shortDigest(ref.digest);
    else text = ref.tag;
    node.appendChild(el('span', '', text));
    node.title =
        risk === 'pinned'
            ? `Pinned by digest ${ref.digest}: the same bytes on every node.`
            : risk === 'tagged'
              ? 'A tag, not a digest: a push to the same tag changes what the next pod runs.'
              : 'A floating tag: which build runs depends on when each node pulled it.';
    return node;
}

const ISSUE_ICON: Record<Issue['kind'], IconName> = {
    invalid: 'failed',
    pull: 'failed',
    'not-ready': 'alert',
    drift: 'digest',
    implicit: 'moving',
    latest: 'moving',
    floating: 'moving',
    frozen: 'snowflake',
    unpinned: 'unlock',
    idle: 'clock',
};

export function issueChip(issue: Issue): HTMLSpanElement {
    const tone: ChipTone = issue.tone === 'ok' ? 'ok' : issue.tone;
    return chip(issue.label, tone, ISSUE_ICON[issue.kind], issue.text);
}

/**
 * The chips worth showing beside an image. `Not pinned` is left out unless
 * asked for: most images in most clusters are tagged, and a chip on every
 * row would stop meaning anything. `tag: false` leaves out what a tag pill
 * next to them already says.
 */
export function issueChips(entry: ImageEntry, opts: { unpinned?: boolean; idle?: boolean; tag?: boolean } = {}): HTMLElement[] {
    return entry.issues
        .filter((i) => (i.kind !== 'unpinned' || opts.unpinned) && (i.kind !== 'idle' || opts.idle !== false) && (opts.tag !== false || !TAG_KINDS.has(i.kind)))
        .map(issueChip);
}

/** Issues the tag pill already says, for rows that draw one beside the chips. */
const TAG_KINDS: ReadonlySet<Issue['kind']> = new Set(['latest', 'implicit', 'floating']);

/** What is wrong with a pull, what to check, and the node's own words. */
export function diagnosisBox(issue: Issue): HTMLElement | null {
    const d = issue.diagnosis;
    if (!d) return null;
    const box = el('div', 'why error');
    box.appendChild(icon('alert'));
    const body = el('div', 'why-body');
    add(body, el('div', 'why-head', d.title), el('div', 'why-hint', d.hint));
    if (d.evidence) {
        const raw = el('code', 'why-raw', d.evidence);
        raw.title = 'As the node reported it';
        body.appendChild(raw);
    }
    box.appendChild(body);
    return box;
}

/** A workload as a button that opens it in the app. `null` when there is nothing the app can open. */
export function workloadButton(w: WorkloadRef, open: (w: WorkloadRef) => void, opts: { namespace?: boolean; detail?: string } = {}): HTMLButtonElement {
    const node = button('', 'wl', kindIcon(w.kind), () => open(w));
    node.dataset.focus = 'wl:' + w.key;
    add(node, el('span', 'wl-name', w.name), opts.namespace !== false ? el('span', 'wl-ns', w.namespace) : null, opts.detail ? el('span', 'wl-detail', opts.detail) : null);
    node.title = `Open ${w.kind} ${w.namespace ? w.namespace + '/' : ''}${w.name}` + (w.appKind ? '' : ' (the app has no tab for this kind; opens its first pod)');
    return node;
}

/** Ready containers of the running ones, as a short bar and the numbers. */
export function readiness(ready: number, total: number, pulling = 0): HTMLElement {
    const node = el('span', 'meter');
    const bar = el('span', 'meter-bar');
    const tone: Tone = pulling ? 'error' : ready < total ? 'warn' : 'ok';
    const fill = el('i', 'meter-fill ' + tone);
    fill.style.width = total ? `${Math.round((ready / total) * 100)}%` : '0%';
    bar.appendChild(fill);
    add(node, bar, el('span', 'meter-text', total ? `${ready}/${total} ready` : 'none running'));
    node.title = total ? `${plural(ready, 'container')} of ${total} running this image ${ready === 1 ? 'is' : 'are'} ready` : 'Nothing runs this image right now';
    return node;
}

/** One running container's state in a word or two, and its tone. */
export function podState(p: PodUse): { text: string; tone: Tone } {
    if (p.finished) return { text: p.phase === 'Succeeded' ? 'Completed' : 'Failed', tone: p.phase === 'Succeeded' ? 'muted' : 'error' };
    if (p.pullError) return { text: p.reason, tone: 'error' };
    if (p.ready) return { text: p.init ? 'Done' : 'Ready', tone: 'ok' };
    if (p.state === 'waiting') return { text: p.reason || 'Waiting', tone: p.reason === 'ContainerCreating' || p.reason === 'PodInitializing' ? 'info' : 'warn' };
    if (p.state === 'running') return { text: 'Not ready', tone: 'warn' };
    if (p.state === 'terminated') return { text: p.reason || 'Terminated', tone: 'warn' };
    return { text: 'Pending', tone: 'info' };
}

/** The image's name, big: repository in full, tag lighter. */
export function imageName(entry: ImageEntry, className = 'iname'): HTMLElement {
    const node = el('span', className);
    const ref = entry.ref;
    if (!ref.valid) {
        node.appendChild(el('span', 'iname-repo', ref.raw.trim()));
        return node;
    }
    const full = familiar(ref, { shortDigest: true });
    const repoText = familiar({ ...ref, tag: '', digest: '' });
    add(node, el('span', 'iname-repo', repoText), el('span', 'iname-tag', full.slice(repoText.length) || ':latest'));
    node.title = entry.key;
    return node;
}
