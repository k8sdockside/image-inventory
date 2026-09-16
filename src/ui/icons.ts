// Single-stroke icons on a 24-unit grid, drawn with currentColor -- the same
// idiom as the app's own set, so the pages sit comfortably beside it.

export const ICONS = {
    // Stacked layers: an image is its layers.
    logo: ['M12 3.2 3.5 7.6 12 12l8.5-4.4z', 'M3.5 12 12 16.4l8.5-4.4', 'M3.5 16.4 12 20.8l8.5-4.4'],
    registry: ['M4 6.5c0-1.4 3.6-2.5 8-2.5s8 1.1 8 2.5-3.6 2.5-8 2.5-8-1.1-8-2.5z', 'M4 6.5v11c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-11', 'M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5'],
    repo: ['M20 8 12 4 4 8v8l8 4 8-4z', 'M4 8l8 4 8-4', 'M12 12v8'],
    tag: ['M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7.3 7.3a1 1 0 0 1-1.4 0z', 'M8 8h.01'],
    digest: ['M9 3.5 7 20.5', 'M17 3.5l-2 17', 'M4 8.5h16', 'M3.5 15.5h16'],
    pin: ['M9 4h6', 'M10 4l-.5 7-3 2.5h11l-3-2.5-.5-7', 'M12 13.5V20'],
    lock: ['M6 10.5h12v9.5H6z', 'M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3'],
    unlock: ['M6 10.5h12v9.5H6z', 'M8.5 10.5V7.5a3.5 3.5 0 0 1 6.8-1.2'],
    pod: ['M12 3l8 4.5v9L12 21l-8-4.5v-9z', 'M12 12l8-4.5', 'M12 12v9', 'M12 12L4 7.5'],
    deployment: ['M3 7l9-4 9 4-9 4-9-4z', 'M3 12l9 4 9-4', 'M3 17l9 4 9-4'],
    statefulset: ['M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z', 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'],
    daemonset: ['M17 2l4 4-4 4', 'M3 11V9a4 4 0 0 1 4-4h14', 'M7 22l-4-4 4-4', 'M21 13v2a4 4 0 0 1-4 4H3'],
    cronjob: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7v5l3 2'],
    job: ['M9 11.5l2.5 2.5L20 5.5', 'M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9'],
    replicaset: ['M9 4h11v11', 'M4 9h11v11H4z'],
    owner: ['M4 5h7v14H4z', 'M15 12h5', 'M17.5 9.5l2.5 2.5-2.5 2.5'],
    container: ['M4 7h16v11H4z', 'M4 7l2-3h12l2 3', 'M9 11h6'],
    init: ['M5 12h9', 'M11 8l4 4-4 4', 'M19 5v14'],
    node: ['M4 5h16v5H4z', 'M4 14h16v5H4z', 'M7.5 7.5h.01', 'M7.5 16.5h.01'],
    alert: ['M12 3.5l9.5 17h-19z', 'M12 10v4', 'M12 17.2h.01'],
    failed: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M9 9l6 6', 'M15 9l-6 6'],
    check: ['M4.5 12.5l5 5L19.5 7'],
    close: ['M6.5 6.5l11 11', 'M17.5 6.5l-11 11'],
    info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v6', 'M12 7.5h.01'],
    clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3.2 2'],
    moving: ['M4 12h11', 'M11 7l5 5-5 5', 'M20 5v14'],
    search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-4-4'],
    open: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v6H4V6h6'],
    chevron: ['M9.5 6l6 6-6 6'],
    'chevron-down': ['M6 9.5l6 6 6-6'],
    restart: ['M20.5 12a8.5 8.5 0 1 1-2.6-6.1', 'M20.5 4v5h-5'],
    // An arrow up out of a circle: something newer to run.
    update: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 16.5v-9', 'M8.5 11 12 7.5l3.5 3.5'],
    logs: ['M4 5h16v14H4z', 'M7.5 9.5l2.5 2.5-2.5 2.5', 'M13 15h4'],
    edit: ['M4 20h4L19 9l-4-4L4 16z', 'M14 6l4 4'],
    chart: ['M4 4v16h16', 'M8 15l3-4 3 2 5-6'],
    rank: ['M6 20v-5', 'M12 20V9', 'M18 20V4'],
    users: ['M9 5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z', 'M2.5 20a6.5 6.5 0 0 1 13 0', 'M16 5.3a3.5 3.5 0 0 1 0 6.4', 'M18 14.3a6.5 6.5 0 0 1 3.5 5.7'],
    namespace: ['M4 6h6l2 2h8v10H4z'],
    globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M3 12h18', 'M12 3a14 14 0 0 1 0 18', 'M12 3a14 14 0 0 0 0 18'],
    book: ['M12 6.5c-1.5-1.3-3.8-2-7-2v13c3.2 0 5.5.7 7 2 1.5-1.3 3.8-2 7-2v-13c-3.2 0-5.5.7-7 2z', 'M12 6.5v13'],
    link: ['M10.5 13.5a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7l-1.2 1.2', 'M13.5 10.5a4 4 0 0 0-5.7 0l-2.3 2.3a4 4 0 0 0 5.7 5.7l1.2-1.2'],
    filter: ['M4 5h16l-6 7.5V19l-4 1.5v-8z'],
    grid: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
    snowflake: ['M12 3v18', 'M4.2 7.5l15.6 9', 'M4.2 16.5l15.6-9', 'M9.5 4.5 12 7l2.5-2.5', 'M9.5 19.5 12 17l2.5 2.5'],
    dot: ['M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'],
} as const satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof ICONS;

/** The icon for a workload kind, as the app draws the same kinds in its sidebar. */
export function kindIcon(kind: string): IconName {
    switch (kind) {
        case 'Deployment':
            return 'deployment';
        case 'StatefulSet':
            return 'statefulset';
        case 'DaemonSet':
            return 'daemonset';
        case 'CronJob':
            return 'cronjob';
        case 'Job':
            return 'job';
        case 'ReplicaSet':
            return 'replicaset';
        case 'Pod':
            return 'pod';
        default:
            return 'owner';
    }
}
