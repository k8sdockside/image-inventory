import { describe, expect, it } from 'vitest';
import { diagnosePull, isPullReason } from './pull';

describe('isPullReason', () => {
    it('knows the reasons a container waits for its image', () => {
        expect(isPullReason('ErrImagePull')).toBe(true);
        expect(isPullReason('ImagePullBackOff')).toBe(true);
        expect(isPullReason('InvalidImageName')).toBe(true);
        expect(isPullReason('CrashLoopBackOff')).toBe(false);
        expect(isPullReason('')).toBe(false);
        expect(isPullReason(undefined)).toBe(false);
    });
});

describe('diagnosePull', () => {
    it.each([
        [
            'missing',
            'ErrImagePull',
            'rpc error: code = NotFound desc = failed to pull and unpack image "docker.io/library/nginx:1.99": failed to resolve reference "docker.io/library/nginx:1.99": docker.io/library/nginx:1.99: not found',
        ],
        ['missing', 'ErrImagePull', 'failed to resolve reference "ghcr.io/org/app:v9": ghcr.io/org/app:v9: manifest unknown'],
        [
            'missing-or-private',
            'ErrImagePull',
            'Error response from daemon: pull access denied for acme/secret, repository does not exist or may require \'docker login\'',
        ],
        [
            'auth',
            'ErrImagePull',
            'rpc error: code = Unknown desc = failed to pull and unpack image "registry.example.com/team/api:1": failed to authorize: failed to fetch anonymous token: unexpected status: 401 Unauthorized',
        ],
        [
            'ratelimit',
            'ErrImagePull',
            'rpc error: code = Unknown desc = failed to pull and unpack image "docker.io/library/redis:7": 429 Too Many Requests - Server message: toomanyrequests: You have reached your pull rate limit.',
        ],
        [
            'network',
            'ErrImagePull',
            'rpc error: code = Unavailable desc = failed to pull image: dial tcp: lookup registry.internal on 10.96.0.10:53: no such host',
        ],
        [
            'tls',
            'ErrImagePull',
            'failed to do request: Head "https://registry.local/v2/app/manifests/1": tls: failed to verify certificate: x509: certificate signed by unknown authority',
        ],
        ['platform', 'ErrImagePull', 'no match for platform in manifest: not found'],
    ])('reads %s', (cause, reason, message) => {
        const d = diagnosePull(reason, [message]);
        expect(d.cause).toBe(cause);
        expect(d.title).not.toBe('');
        expect(d.hint).not.toBe('');
        expect(d.evidence).toBe(message);
    });

    it('looks past the backoff message to the one that says why', () => {
        const d = diagnosePull('ImagePullBackOff', [
            'Back-off pulling image "nginx:1.99"',
            'Failed to pull image "nginx:1.99": rpc error: code = NotFound desc = failed to pull and unpack image: not found',
        ]);
        expect(d.cause).toBe('missing');
        expect(d.evidence).toMatch(/^Failed to pull image/);
    });

    it('says it cannot tell from the backoff message alone', () => {
        const d = diagnosePull('ImagePullBackOff', ['Back-off pulling image "nginx:1.99"']);
        expect(d.cause).toBe('unknown');
        expect(d.evidence).toBe('Back-off pulling image "nginx:1.99"');
        expect(d.hint).toMatch(/events/);
    });

    it('does not read a status code into the hex of a digest', () => {
        const d = diagnosePull('ErrImagePull', ['failed to pull "app@sha256:a404b503c429d401e403f000000000000000000000000000000000000000000": something odd']);
        expect(d.cause).toBe('unknown');
    });

    it('answers invalid names and pull policy Never from the reason', () => {
        expect(diagnosePull('InvalidImageName', ['Failed to apply default image tag "Nginx": couldn\'t parse image reference']).cause).toBe('invalid');
        expect(diagnosePull('ErrImageNeverPull', ['Container image "app:1" is not present with pull policy of Never']).cause).toBe('never');
    });
});
