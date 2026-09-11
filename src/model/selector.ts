// A workload's label selector, as the text the bridge's `list` takes, and the
// ownership test that tells a workload's own pods from others that happen to
// carry the same labels. Pure functions; see selector.test.ts.

import type { KubeObject, LabelSelector } from './kube';

/**
 * `{ matchLabels: { app: 'web' }, matchExpressions: [{ key: 'tier', operator: 'In', values: ['a', 'b'] }] }`
 * becomes `app=web,tier in (a,b)`. `''` selects everything, which is what an
 * empty selector means too.
 */
export function selectorString(selector: LabelSelector | null | undefined): string {
    if (!selector) return '';
    const parts: string[] = [];
    const labels = selector.matchLabels ?? {};
    for (const key of Object.keys(labels).sort()) parts.push(`${key}=${labels[key] ?? ''}`);
    for (const req of selector.matchExpressions ?? []) {
        const values = (req.values ?? []).join(',');
        switch (req.operator) {
            case 'In':
                parts.push(`${req.key} in (${values})`);
                break;
            case 'NotIn':
                parts.push(`${req.key} notin (${values})`);
                break;
            case 'Exists':
                parts.push(req.key);
                break;
            case 'DoesNotExist':
                parts.push(`!${req.key}`);
                break;
            default:
                // An operator Kubernetes does not have would be refused by the
                // API server long before it got here; leaving it out widens
                // the list, and ownership narrows it again.
                break;
        }
    }
    return parts.join(',');
}

/** Whether `obj` is controlled by the object with this uid. */
export function isOwnedBy(obj: KubeObject, uid: string | undefined): boolean {
    if (!uid) return false;
    return (obj.metadata.ownerReferences ?? []).some((o) => o.uid === uid);
}
