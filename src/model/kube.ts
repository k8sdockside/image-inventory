// The few fields of Kubernetes objects this plugin reads, and nothing more.
//
// The bridge hands back objects whole, as the API server wrote them; these
// describe only what is used, so a typo in a field name is a compile error
// rather than an `undefined` on screen. Everything is optional, because a
// half-created object, a cluster that is older or newer than expected, or a
// kind that was not readable at all must never take a page down.

export type KubeObject = K8sDockside.KubeObject;

export interface Container {
    name: string;
    image?: string;
    imagePullPolicy?: string;
}

export interface PodSpec {
    containers?: Container[];
    initContainers?: Container[];
    nodeName?: string;
    imagePullSecrets?: { name?: string }[];
}

export interface PodTemplateSpec {
    metadata?: { labels?: Record<string, string>; annotations?: Record<string, string> };
    spec?: PodSpec;
}

export interface ContainerState {
    waiting?: { reason?: string; message?: string };
    running?: { startedAt?: string };
    terminated?: { reason?: string; message?: string; exitCode?: number; finishedAt?: string };
}

export interface ContainerStatus {
    name: string;
    image?: string;
    imageID?: string;
    ready?: boolean;
    started?: boolean;
    restartCount?: number;
    state?: ContainerState;
    lastState?: ContainerState;
}

export interface PodStatus {
    phase?: string;
    containerStatuses?: ContainerStatus[];
    initContainerStatuses?: ContainerStatus[];
}

export interface Pod extends KubeObject {
    spec?: PodSpec;
    status?: PodStatus;
}

export interface LabelSelectorRequirement {
    key: string;
    operator: string;
    values?: string[];
}

export interface LabelSelector {
    matchLabels?: Record<string, string>;
    matchExpressions?: LabelSelectorRequirement[];
}

/** A Deployment, StatefulSet, DaemonSet or ReplicaSet: a pod template behind a selector. */
export interface Workload extends KubeObject {
    spec?: {
        selector?: LabelSelector;
        template?: PodTemplateSpec;
        replicas?: number;
        paused?: boolean;
    };
    status?: {
        replicas?: number;
        readyReplicas?: number;
        updatedReplicas?: number;
        availableReplicas?: number;
        numberReady?: number;
        desiredNumberScheduled?: number;
    };
}

export interface Job extends KubeObject {
    spec?: { template?: PodTemplateSpec };
}

export interface CronJob extends KubeObject {
    spec?: {
        schedule?: string;
        suspend?: boolean;
        jobTemplate?: { spec?: { template?: PodTemplateSpec } };
    };
}

export interface KubeEvent extends KubeObject {
    involvedObject?: { kind?: string; namespace?: string; name?: string; fieldPath?: string };
    reason?: string;
    message?: string;
    type?: string;
    count?: number;
    firstTimestamp?: string;
    lastTimestamp?: string;
    eventTime?: string;
    series?: { lastObservedTime?: string; count?: number };
}

/** The Kubernetes kind of a workload, and the app's name for the same kind. */
export const APP_KINDS: Readonly<Record<string, string>> = {
    Deployment: 'deployments',
    StatefulSet: 'statefulsets',
    DaemonSet: 'daemonsets',
    ReplicaSet: 'replicasets',
    Job: 'jobs',
    CronJob: 'cronjobs',
    Pod: 'pods',
};

/** The owner that controls an object: the one with `controller: true`, or else the first. */
export function controllerOf(obj: KubeObject): K8sDockside.OwnerReference | null {
    const owners = obj.metadata.ownerReferences ?? [];
    return owners.find((o) => o.controller) ?? owners[0] ?? null;
}

/** When an event last happened, in milliseconds; 0 when it does not say. */
export function eventTime(ev: KubeEvent): number {
    const raw = ev.series?.lastObservedTime || ev.lastTimestamp || ev.eventTime || ev.firstTimestamp || ev.metadata.creationTimestamp || '';
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : 0;
}
