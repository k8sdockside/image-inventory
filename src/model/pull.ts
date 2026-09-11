// Why an image will not pull, in plain words.
//
// The kubelet says a container is waiting with a reason -- ErrImagePull, then
// ImagePullBackOff while it waits to try again -- and a message that is the
// runtime's error passed straight through: "rpc error: code = NotFound desc =
// failed to pull and unpack image …: not found". The backoff message says
// nothing but "Back-off pulling image", so the cause usually has to be found
// in the earlier message or in the pod's events. This turns whichever of
// those is at hand into the one thing to go and check.
//
// Pure functions only. See pull.test.ts.

/** The waiting reasons that mean a container has no image to run. */
export const PULL_REASONS: ReadonlySet<string> = new Set([
    'ErrImagePull',
    'ImagePullBackOff',
    'InvalidImageName',
    'ErrImageNeverPull',
    'RegistryUnavailable',
    'ErrImageInspect',
    'SignatureValidationFailed',
]);

export function isPullReason(reason: string | undefined): boolean {
    return !!reason && PULL_REASONS.has(reason);
}

export type PullCause =
    | 'missing'
    | 'missing-or-private'
    | 'auth'
    | 'ratelimit'
    | 'network'
    | 'tls'
    | 'platform'
    | 'invalid'
    | 'never'
    | 'unknown';

export interface PullDiagnosis {
    cause: PullCause;
    /** What is wrong, in one short sentence. */
    title: string;
    /** What to check first. */
    hint: string;
    /** The most telling message the diagnosis was read from, as the node wrote it. */
    evidence: string;
}

const BACKOFF_ONLY = /^back-off pulling image/i;

interface Rule {
    cause: PullCause;
    test: RegExp;
    title: string;
    hint: string;
}

// Order matters: a rate-limit reply is also a 4xx, a missing platform is
// reported as "no match for platform in manifest: not found", and Docker Hub
// answers "pull access denied … may require 'docker login'" for a repository
// that does not exist as well as for a private one.
const RULES: Rule[] = [
    {
        cause: 'ratelimit',
        test: /toomanyrequests|too many requests|rate limit|\b429\b/,
        title: 'The registry is rate-limiting pulls',
        hint: 'Docker Hub limits anonymous pulls per IP. Pull with credentials (an imagePullSecret), or mirror the image into a registry you run.',
    },
    {
        cause: 'platform',
        test: /no match for platform|exec format error|does not match the specified platform/,
        title: "There is no build of this image for the node's CPU",
        hint: 'The image was not published for this architecture (arm64 or amd64). Build a multi-arch image, or keep the pod off these nodes.',
    },
    {
        cause: 'missing-or-private',
        test: /pull access denied|repository does not exist or may require/,
        title: 'The repository does not exist, or it is private',
        hint: 'The registry gives the same answer for both. Check the name for a typo; if it is private, the pod needs an imagePullSecret that can read it.',
    },
    {
        cause: 'missing',
        test: /manifest unknown|not found|name unknown|no such image|does not exist|\b404\b/,
        title: 'That tag does not exist in the registry',
        hint: 'The repository answered, but not with this tag. Check the tag was pushed -- a CI job that failed, or a typo in the version.',
    },
    {
        cause: 'auth',
        test: /unauthorized|authentication required|denied|forbidden|insufficient_scope|no basic auth credentials|\b40[13]\b/,
        title: 'The registry refused the credentials',
        hint: "Check the pod's imagePullSecrets (or its service account's) exist in this namespace and are still valid. Expired tokens are the usual cause.",
    },
    {
        cause: 'tls',
        test: /x509|certificate signed by unknown authority|certificate is not valid|tls: /,
        title: "The node does not trust the registry's certificate",
        hint: "Install the registry's CA on the nodes, or configure the runtime to trust it. HTTPS to a private registry is the usual case.",
    },
    {
        cause: 'network',
        test: /no such host|dial tcp|i\/o timeout|connection refused|connection reset|context deadline exceeded|network is unreachable|server misbehaving|\beof\b|service unavailable|\b50[234]\b/,
        title: 'The node could not reach the registry',
        hint: 'A DNS name that does not resolve, a proxy or firewall in the way, or the registry being down. Try pulling from the node itself.',
    },
];

/**
 * Reads the cause from the waiting reason and every message at hand -- the
 * container's own and its pod's events -- preferring whichever says most.
 */
export function diagnosePull(reason: string, messages: readonly string[]): PullDiagnosis {
    const useful = messages.map((m) => m.trim()).filter((m) => m && !BACKOFF_ONLY.test(m));
    const evidence = useful[0] ?? messages.find((m) => m.trim()) ?? '';

    if (reason === 'InvalidImageName') {
        return {
            cause: 'invalid',
            title: 'The image name is not valid',
            hint: 'A runtime cannot read this reference at all: an uppercase letter, a stray space, or a tag with characters tags cannot have.',
            evidence,
        };
    }
    if (reason === 'ErrImageNeverPull') {
        return {
            cause: 'never',
            title: 'The pod may not pull, and the image is not on the node',
            hint: 'imagePullPolicy is Never, so the image has to be loaded onto every node that might run the pod -- or the policy changed to IfNotPresent.',
            evidence,
        };
    }

    // Digests are long runs of hex, where a 404 or a 503 turns up by chance.
    const text = useful.join('\n').toLowerCase().replace(/[a-z0-9]+:[a-f0-9]{32,}/g, '');
    for (const rule of RULES) {
        if (rule.test.test(text)) return { cause: rule.cause, title: rule.title, hint: rule.hint, evidence };
    }
    return {
        cause: 'unknown',
        title: 'The image could not be pulled',
        hint: useful.length
            ? 'The node gave the reason below.'
            : 'The kubelet is backing off between attempts; the reason is in the pod’s events from the first attempt.',
        evidence,
    };
}
