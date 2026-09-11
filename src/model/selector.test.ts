import { describe, expect, it } from 'vitest';
import { isOwnedBy, selectorString } from './selector';

describe('selectorString', () => {
    it('writes matchLabels, sorted', () => {
        expect(selectorString({ matchLabels: { tier: 'web', app: 'shop' } })).toBe('app=shop,tier=web');
    });

    it('writes every expression operator', () => {
        expect(
            selectorString({
                matchLabels: { app: 'shop' },
                matchExpressions: [
                    { key: 'env', operator: 'In', values: ['prod', 'staging'] },
                    { key: 'track', operator: 'NotIn', values: ['canary'] },
                    { key: 'owner', operator: 'Exists' },
                    { key: 'legacy', operator: 'DoesNotExist' },
                ],
            }),
        ).toBe('app=shop,env in (prod,staging),track notin (canary),owner,!legacy');
    });

    it('selects everything for an empty or missing selector', () => {
        expect(selectorString({})).toBe('');
        expect(selectorString(undefined)).toBe('');
        expect(selectorString(null)).toBe('');
    });

    it('leaves out an operator Kubernetes does not have', () => {
        expect(selectorString({ matchExpressions: [{ key: 'x', operator: 'Like', values: ['y'] }] })).toBe('');
    });
});

describe('isOwnedBy', () => {
    const obj = { metadata: { name: 'web-7d4b9c-abcde', ownerReferences: [{ apiVersion: 'apps/v1', kind: 'ReplicaSet', name: 'web-7d4b9c', uid: 'rs-1', controller: true }] } };

    it('matches the owner uid', () => {
        expect(isOwnedBy(obj, 'rs-1')).toBe(true);
        expect(isOwnedBy(obj, 'rs-2')).toBe(false);
        expect(isOwnedBy(obj, undefined)).toBe(false);
        expect(isOwnedBy({ metadata: { name: 'bare' } }, 'rs-1')).toBe(false);
    });
});
