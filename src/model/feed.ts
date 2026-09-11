// Keeps the lists an inventory is built from fresh, through the bridge's
// `watch`: pods every few seconds, since they are what changes, and the
// workloads that own them and the events that explain them less often.
//
// A kind that cannot be read -- a role that may list pods but not cronjobs,
// say -- costs only what it would have added: pods are still grouped, just
// one step less far up their owner chain. Only pods failing is a failure.

import { fingerprint, type ClusterData } from './inventory';
import type { CronJob, Job, KubeEvent, KubeObject, Pod, Workload } from './kube';

export type FeedKind = 'pods' | 'deployments' | 'statefulsets' | 'daemonsets' | 'replicasets' | 'jobs' | 'cronjobs' | 'events';

export interface FeedState {
    data: ClusterData;
    /** Why a kind could not be read, by kind. */
    errors: Partial<Record<FeedKind, string>>;
    /** Whether pods have answered at least once: until then there is nothing to draw. */
    ready: boolean;
}

export interface FeedOptions {
    /** One namespace, or every namespace when left out. */
    namespace?: string;
    /** Milliseconds between pod polls. */
    fast?: number;
    /** Milliseconds between polls of everything else. */
    slow?: number;
    /** Called whenever a list comes back different from the last time. */
    onChange: (state: FeedState) => void;
}

const SLOW_KINDS: FeedKind[] = ['deployments', 'statefulsets', 'daemonsets', 'replicasets', 'jobs', 'cronjobs', 'events'];

/** A cheap fingerprint of a list: which objects, at which resourceVersion. */
function listPrint(items: KubeObject[]): string {
    return fingerprint(items.map((o) => `${o.metadata.uid ?? o.metadata.namespace + '/' + o.metadata.name}@${o.metadata.resourceVersion ?? ''}`).join('|'));
}

export function startFeed(bridge: K8sDockside.Bridge, opts: FeedOptions): () => void {
    const state: FeedState = { data: { pods: [] }, errors: {}, ready: false };
    const prints = new Map<FeedKind, string>();
    const stops: (() => void)[] = [];

    function accept(kind: FeedKind, items: KubeObject[]): void {
        const print = listPrint(items);
        const hadError = kind in state.errors;
        delete state.errors[kind];
        if (prints.get(kind) === print && !hadError && (kind !== 'pods' || state.ready)) return;
        prints.set(kind, print);
        switch (kind) {
            case 'pods':
                state.data.pods = items as Pod[];
                state.ready = true;
                break;
            case 'jobs':
                state.data.jobs = items as Job[];
                break;
            case 'cronjobs':
                state.data.cronjobs = items as CronJob[];
                break;
            case 'events':
                state.data.events = items as KubeEvent[];
                break;
            default:
                state.data[kind] = items as Workload[];
        }
        opts.onChange(state);
    }

    function refuse(kind: FeedKind, err: Error): void {
        if (state.errors[kind] === err.message) return;
        state.errors[kind] = err.message;
        opts.onChange(state);
    }

    const watch = (kind: FeedKind, interval: number): void => {
        stops.push(
            bridge.watch(
                { kind, namespace: opts.namespace ?? '', interval },
                (items) => accept(kind, items),
                (err) => refuse(kind, err),
            ),
        );
    };

    watch('pods', opts.fast ?? 5000);
    for (const kind of SLOW_KINDS) watch(kind, opts.slow ?? 15000);
    return () => stops.forEach((stop) => stop());
}
