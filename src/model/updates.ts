// The Updates page's model: which images running in the cluster have newer
// versions in their registries.
//
// It joins two things. The inventory says what runs -- each image reference,
// the workloads and pods running it, and the build (digest) each pod pulled.
// The registries' answers (`registry.lookup`, one per reference, asked by the
// app) say which tags a repository has and which build the image's tag points
// at today. Between them, one row per reference that runs:
//
// - a version tag (`1.27.3`) is offered the newest patch, minor and major
//   versions among the repository's tags (see versions.ts);
// - any tag, version or not, whose registry build is not the one some pods
//   run was pushed again since they pulled it -- for `latest` or `main` that
//   is the only way to tell there is something newer.
//
// Rows are built again whenever an answer arrives, so the page can draw them
// as they come in. Pure functions only. See updates.test.ts.

import { DOCKER_HUB, effectiveTag, registryInfo, type ImageRef } from './image-ref';
import { comparableDigest, fingerprint, type ImageEntry, type Inventory, type Usage, type WorkloadRef } from './inventory';
import { findUpdates, newestVersion, noUpdates, parseVersion, type Updates } from './versions';

/**
 * Where an image stands:
 *
 * - `major`, `minor`, `patch` -- newer versions exist; the biggest step names it
 * - `rebuilt`  -- no newer version to name, but the tag now points at a build some pods do not run
 * - `current`  -- nothing newer: a version tag with no later one, or a tag whose build every pod runs
 * - `unknown`  -- nothing to compare: a tag that is not a version and a build that could not be compared, or a digest with no tag
 * - `failed`   -- the registry could not be asked
 * - `pending`  -- not asked yet
 */
export type UpdateState = 'major' | 'minor' | 'patch' | 'rebuilt' | 'current' | 'unknown' | 'failed' | 'pending';

/** The order rows are listed in: the biggest updates first, what is fine last. */
export const STATE_ORDER: readonly UpdateState[] = ['major', 'minor', 'patch', 'rebuilt', 'failed', 'unknown', 'pending', 'current'];

const STATE_RANK = Object.fromEntries(STATE_ORDER.map((s, i) => [s, i])) as Record<UpdateState, number>;

/** Whether there is something newer to run: a version, or a newer build of the same tag. */
export function hasUpdate(state: UpdateState): boolean {
    return state === 'major' || state === 'minor' || state === 'patch' || state === 'rebuilt';
}

/** The most tags the app reads from one repository. */
export const TAG_LIMIT = 10_000;

export type FailedStatus = Exclude<K8sDockside.RegistryStatus, 'ok'>;

/** A failed answer in a word or two, for a chip. */
export const FAILURE_LABEL: Readonly<Record<FailedStatus, string>> = {
    auth: 'needs credentials',
    limited: 'rate-limited',
    missing: 'not found',
    unreachable: 'unreachable',
    error: 'failed',
};

/** A failed answer as a clause, for a summary of several: "…, mostly because the registry wants credentials". */
export const FAILURE_GIST: Readonly<Record<FailedStatus, string>> = {
    auth: 'the registry wants credentials',
    limited: 'the registry is rate-limiting',
    missing: 'the registry does not know the repository',
    unreachable: 'the registry could not be reached',
    error: 'the registry could not be asked',
};

/** Why the registry could not be asked, as a sentence. `''` for an answer that did not fail. */
export function failureText(lookup: Pick<K8sDockside.RegistryLookup, 'status' | 'registry' | 'error'>): string {
    switch (lookup.status) {
        case 'ok':
            return '';
        case 'auth':
            return 'The registry wants credentials; only public images are checked.';
        case 'limited':
            return 'The registry is rate-limiting; try again later.';
        case 'missing':
            return 'The registry does not know this repository (or this tag).';
        case 'unreachable':
            return `Could not reach ${lookup.registry}` + (lookup.error ? `: ${lookup.error}` : '.');
        default:
            return lookup.error || 'The registry could not be asked.';
    }
}

/**
 * The answer to record when the app refused to ask at all -- the reference
 * is not one it accepts, or the pod running it has gone -- so the row says
 * why instead of waiting forever.
 */
export function refusedLookup(ref: ImageRef, image: string, reason: string, now: string): K8sDockside.RegistryLookup {
    return {
        image,
        registry: ref.registry,
        repository: ref.repository,
        tag: effectiveTag(ref),
        tags: [],
        truncated: false,
        digest: '',
        checkedAt: now,
        status: 'error',
        error: reason,
    };
}

/** A web page listing a repository's tags, where one is obvious: Docker Hub and Quay. */
export function tagsPage(ref: ImageRef): { label: string; url: string } | null {
    if (ref.registry === DOCKER_HUB) {
        const official = ref.repository.startsWith('library/');
        return {
            label: 'Tags on Docker Hub',
            url: official ? `https://hub.docker.com/_/${ref.repository.slice('library/'.length)}/tags` : `https://hub.docker.com/r/${ref.repository}/tags`,
        };
    }
    if (ref.registry === 'quay.io') return { label: 'Tags on Quay', url: `https://quay.io/repository/${ref.repository}?tab=tags` };
    return null;
}

export interface WorkloadUse {
    workload: WorkloadRef;
    /** One of its usages, to open a pod from when the app has no tab for the workload's kind. */
    usage: Usage;
    /** Its containers running the image now. */
    running: number;
}

export interface UpdateRow {
    /** The canonical reference, as the inventory keys it. */
    key: string;
    entry: ImageEntry;
    /** The tag the runtime pulls: the one written, or `latest`; `''` for a reference that names only a digest. */
    tag: string;
    /** What the app is asked about -- the reference as a running pod writes it; `''` when it is not asked. */
    ask: string;
    /** The tag reads as a version, so newer versions can be looked for. */
    versioned: boolean;
    /** The registry's answer; `null` until there is one, and for a reference that is not asked. */
    lookup: K8sDockside.RegistryLookup | null;
    state: UpdateState;
    updates: Updates;
    /** For a tag that is not a version: the newest release the repository has, to say what `latest` stands for now. */
    newest: string | null;
    /** The registry's tag points at a build some pods here do not run: it was pushed again since they pulled it. */
    repushed: boolean;
    /** Containers running a build other than the registry's. */
    behind: number;
    /** The builds those containers run, most used first. */
    staleDigests: string[];
    /** Why the registry could not be asked, as a sentence; `''` unless the row failed. */
    reason: string;
    /** Anything else worth knowing about the answer: why the row cannot tell, or that the tag list was cut short. */
    note: string;
    /** Containers running the image now. */
    containers: number;
    /** The workloads running it, busiest first. */
    workloads: WorkloadUse[];
    namespaces: string[];
    registryLabel: string;
}

function workloadsOf(entry: ImageEntry): WorkloadUse[] {
    const byKey = new Map<string, WorkloadUse>();
    for (const usage of entry.usages) {
        const running = usage.pods.filter((p) => !p.finished).length;
        if (!running) continue;
        const have = byKey.get(usage.workload.key);
        if (have) have.running += running;
        else byKey.set(usage.workload.key, { workload: usage.workload, usage, running });
    }
    return [...byKey.values()].sort((a, b) => b.running - a.running || a.workload.key.localeCompare(b.workload.key));
}

/** One image's row, from its inventory entry and the registry's answer (or none yet). */
export function updateRow(entry: ImageEntry, lookup: K8sDockside.RegistryLookup | null): UpdateRow {
    const ref = entry.ref;
    const tag = effectiveTag(ref);
    const workloads = workloadsOf(entry);
    const row: UpdateRow = {
        key: entry.key,
        entry,
        tag,
        ask: tag ? entry.podSpelling : '',
        versioned: !!tag && parseVersion(tag) !== null,
        lookup: tag ? lookup : null,
        state: 'pending',
        updates: noUpdates(),
        newest: null,
        repushed: false,
        behind: 0,
        staleDigests: [],
        reason: '',
        note: '',
        containers: entry.containers,
        workloads,
        namespaces: [...new Set(workloads.map((w) => w.workload.namespace))].sort(),
        registryLabel: registryInfo(ref.registry).label,
    };
    if (!tag) {
        row.state = 'unknown';
        row.note = 'Pinned by a digest alone: there is no tag to look for newer versions of.';
        return row;
    }
    if (!row.lookup) return row;
    const answer = row.lookup;
    if (answer.status !== 'ok') {
        row.state = 'failed';
        row.reason = failureText(answer);
        return row;
    }

    row.updates = findUpdates(tag, answer.tags);
    if (!row.versioned) row.newest = newestVersion(answer.tags);

    // The build each running container pulled -- a pinned reference's pods
    // run the pinned one -- against the build the tag points at now. A
    // digest the node recorded under another repository is left out.
    const builds: string[] = [];
    for (const u of entry.usages) {
        for (const p of u.pods) {
            const build = p.finished ? '' : comparableDigest(p, ref);
            if (build) builds.push(build);
        }
    }
    const compared = !!answer.digest && builds.length > 0;
    if (compared) {
        const stale = builds.filter((d) => d !== answer.digest);
        const counts = new Map<string, number>();
        for (const d of stale) counts.set(d, (counts.get(d) ?? 0) + 1);
        row.behind = stale.length;
        row.staleDigests = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([d]) => d);
        row.repushed = stale.length > 0;
    }

    if (row.updates.kind) row.state = row.updates.kind;
    else if (row.repushed) row.state = 'rebuilt';
    else if (row.versioned || compared) row.state = 'current';
    else {
        row.state = 'unknown';
        row.note = !answer.digest
            ? `:${tag} is not a version, and the registry did not say which build it points at.`
            : `:${tag} is not a version, and no pod has reported which build it runs yet.`;
    }
    if (answer.truncated) {
        const cut = `Only the first ${TAG_LIMIT} tags were read, so a newer one may be missing.`;
        row.note = row.note ? `${row.note} ${cut}` : cut;
    }
    return row;
}

/** The biggest updates first, then the images the most containers run. */
export function byUrgency(a: UpdateRow, b: UpdateRow): number {
    return STATE_RANK[a.state] - STATE_RANK[b.state] || b.containers - a.containers || a.key.localeCompare(b.key);
}

export interface UpdateSummary {
    /** Images running, one per reference. */
    images: number;
    counts: Record<UpdateState, number>;
    /** Images with something newer to run: a version, or a newer build of their tag. */
    updates: number;
    /** Containers running those, and the workloads they belong to. */
    containers: number;
    workloads: number;
    /** Images whose tag was pushed again since some of their pods pulled it, whatever their state. */
    repushed: number;
    /** Images the registries are asked about -- every one but those pinned by a digest alone -- and how many have answered. */
    askable: number;
    answered: number;
    /** When the oldest answer was given, in milliseconds; 0 when there is none. */
    oldestAnswer: number;
    /** The commonest reason an image could not be checked, and how many images it applies to; `null` when none is commoner than the rest. */
    commonFailure: { status: FailedStatus; gist: string; count: number } | null;
}

export interface UpdateReport {
    rows: UpdateRow[];
    summary: UpdateSummary;
    /** Changes whenever anything drawn from the report would. */
    signature: string;
}

function summarise(rows: UpdateRow[]): UpdateSummary {
    const counts = Object.fromEntries(STATE_ORDER.map((s) => [s, 0])) as Record<UpdateState, number>;
    const failures = new Map<FailedStatus, number>();
    const workloads = new Set<string>();
    let containers = 0;
    let oldest = 0;
    for (const r of rows) {
        counts[r.state]++;
        if (hasUpdate(r.state)) {
            containers += r.containers;
            for (const w of r.workloads) workloads.add(w.workload.key);
        }
        if (r.lookup && r.lookup.status !== 'ok') failures.set(r.lookup.status, (failures.get(r.lookup.status) ?? 0) + 1);
        const t = r.lookup ? Date.parse(r.lookup.checkedAt) : NaN;
        if (Number.isFinite(t) && (!oldest || t < oldest)) oldest = t;
    }
    // Only a reason more common than every other is worth naming.
    let commonFailure: UpdateSummary['commonFailure'] = null;
    let tied = false;
    for (const [status, count] of failures) {
        if (commonFailure && count === commonFailure.count) tied = true;
        if (!commonFailure || count > commonFailure.count) {
            commonFailure = { status, gist: FAILURE_GIST[status], count };
            tied = false;
        }
    }
    if (tied) commonFailure = null;
    return {
        images: rows.length,
        counts,
        updates: rows.filter((r) => hasUpdate(r.state)).length,
        containers,
        workloads: workloads.size,
        repushed: rows.filter((r) => r.repushed).length,
        askable: rows.filter((r) => r.ask).length,
        answered: rows.filter((r) => r.ask && r.lookup).length,
        oldestAnswer: oldest,
        commonFailure,
    };
}

/**
 * Every image that runs, with what its registry said about it. `lookups` is
 * keyed by the inventory's key (the canonical reference). Images nothing runs
 * are left out, and so are references no runtime would accept: there is no
 * registry to ask about those, and the Images page says what is wrong.
 */
export function buildUpdates(inv: Inventory, lookups: ReadonlyMap<string, K8sDockside.RegistryLookup>): UpdateReport {
    const rows = inv.images.filter((i) => i.running && i.ref.valid).map((i) => updateRow(i, lookups.get(i.key) ?? null));
    rows.sort(byUrgency);
    return {
        rows,
        summary: summarise(rows),
        signature: fingerprint(
            inv.signature +
                JSON.stringify(
                    rows.map((r) => [r.key, r.state, r.updates, r.newest, r.behind, r.reason, r.note, r.lookup?.checkedAt ?? '', r.lookup?.digest ?? '', r.workloads.map((w) => [w.workload.key, w.running])]),
                ),
        ),
    };
}
