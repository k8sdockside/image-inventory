// Container image references, taken apart the way a container runtime reads
// them -- the rules of github.com/distribution/reference, which containerd,
// CRI-O and Docker all share:
//
//     nginx                           docker.io / library/nginx  (tag: latest, implied)
//     grafana/grafana:10.4.2          docker.io / grafana/grafana : 10.4.2
//     ghcr.io/org/app:v1@sha256:...   ghcr.io / org/app : v1 @ sha256:...
//     localhost:5000/tools/cli        localhost:5000 / tools/cli  (a port, not a tag)
//
// The first path component is a registry host only if it has a dot or a
// colon in it, is `localhost`, or has an uppercase letter; otherwise the
// image is on Docker Hub, and a one-part name there is an official image
// under `library/`. A colon is a tag only after the last slash. No tag and no
// digest means `:latest`.
//
// Pure functions only: no DOM, no bridge. See image-ref.test.ts.

export interface ImageRef {
    /** As written in the pod spec. */
    raw: string;
    /** The registry host, with Docker Hub's aliases folded into `docker.io`. */
    registry: string;
    /** The path inside the registry, with `library/` for Docker Hub's official images. */
    repository: string;
    /** The tag as written; `''` when none was. */
    tag: string;
    /** `algorithm:hex` when the reference is pinned by digest; `''` when not. */
    digest: string;
    /** No registry was written, so Docker Hub was assumed. */
    implicitRegistry: boolean;
    /** Neither a tag nor a digest was written, so the runtime pulls `:latest`. */
    implicitTag: boolean;
    /** Whether the reference is one a runtime would accept. */
    valid: boolean;
    /** Why it is not, in words; `''` when it is. */
    problem: string;
}

export const DOCKER_HUB = 'docker.io';

/** Hosts that are Docker Hub under another name. */
const HUB_ALIASES = new Set(['index.docker.io', 'registry-1.docker.io', 'registry.hub.docker.com']);

const TAG = /^[\w][\w.-]{0,127}$/;
const DIGEST = /^[a-z0-9]+(?:[.+_-][a-z0-9]+)*:[a-zA-Z0-9=_-]{32,}$/;
const PATH_COMPONENT = /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/;

export function parseImageRef(raw: string): ImageRef {
    const text = raw.trim();
    const ref: ImageRef = {
        raw,
        registry: DOCKER_HUB,
        repository: '',
        tag: '',
        digest: '',
        implicitRegistry: true,
        implicitTag: false,
        valid: true,
        problem: '',
    };
    const refuse = (problem: string): void => {
        if (ref.valid) {
            ref.valid = false;
            ref.problem = problem;
        }
    };
    if (!text) {
        refuse('no image is named');
        return ref;
    }
    if (/\s/.test(text)) refuse('it has a space in it');

    let name = text;
    const at = name.indexOf('@');
    if (at >= 0) {
        ref.digest = name.slice(at + 1);
        name = name.slice(0, at);
        if (!DIGEST.test(ref.digest)) refuse(`"${ref.digest}" is not a digest`);
    }

    const colon = name.lastIndexOf(':');
    if (colon > name.lastIndexOf('/')) {
        ref.tag = name.slice(colon + 1);
        name = name.slice(0, colon);
        if (!TAG.test(ref.tag)) refuse(`"${ref.tag}" is not a valid tag`);
    }

    const slash = name.indexOf('/');
    const first = slash >= 0 ? name.slice(0, slash) : '';
    const isHost = slash >= 0 && (/[.:]/.test(first) || first === 'localhost' || first !== first.toLowerCase());
    if (isHost) {
        ref.registry = HUB_ALIASES.has(first.toLowerCase()) ? DOCKER_HUB : first;
        ref.implicitRegistry = false;
        name = name.slice(slash + 1);
    }
    if (ref.registry === DOCKER_HUB && name && !name.includes('/')) name = 'library/' + name;
    ref.repository = name;

    if (!name) refuse('it names a registry but no repository');
    else if (!name.split('/').every((part) => PATH_COMPONENT.test(part))) {
        refuse(name !== name.toLowerCase() ? 'repository names must be lowercase' : `"${name}" is not a valid repository name`);
    }

    ref.implicitTag = !ref.tag && !ref.digest;
    return ref;
}

/** The tag the runtime actually asks for: the one written, `latest` when none is, `''` when only a digest is. */
export function effectiveTag(ref: ImageRef): string {
    if (ref.tag) return ref.tag;
    return ref.digest ? '' : 'latest';
}

/**
 * The reference fully spelled out: `docker.io/library/nginx:latest`. Two
 * spellings of the same image -- `nginx` and `docker.io/library/nginx:latest`
 * -- come out the same, which is what makes it a key.
 */
export function canonical(ref: ImageRef): string {
    const tag = effectiveTag(ref);
    return `${ref.registry}/${ref.repository}${tag ? ':' + tag : ''}${ref.digest ? '@' + ref.digest : ''}`;
}

/** The registry and repository, without tag or digest: `docker.io/library/nginx`. */
export function repositoryKey(ref: ImageRef): string {
    return `${ref.registry}/${ref.repository}`;
}

/** The repository as people write it: Docker Hub and `library/` left out. */
export function familiarRepository(ref: ImageRef): string {
    if (ref.registry !== DOCKER_HUB) return `${ref.registry}/${ref.repository}`;
    return ref.repository.startsWith('library/') ? ref.repository.slice('library/'.length) : ref.repository;
}

/** The whole reference as people write it: `nginx:1.27`, `ghcr.io/org/app:v1@sha256:1a2b…`. */
export function familiar(ref: ImageRef, opts: { shortDigest?: boolean } = {}): string {
    const digest = ref.digest ? '@' + (opts.shortDigest ? shortDigest(ref.digest) : ref.digest) : '';
    return familiarRepository(ref) + (ref.tag ? ':' + ref.tag : '') + digest;
}

/** `sha256:` and the first twelve characters of the hash -- the way docker writes an image id. */
export function shortDigest(digest: string): string {
    const cut = digest.indexOf(':');
    if (cut < 0) return digest.slice(0, 12);
    return digest.slice(0, cut + 1) + digest.slice(cut + 1, cut + 13);
}

/**
 * The digest in a container status's `imageID`, whichever runtime wrote it:
 *
 *     docker.io/library/nginx@sha256:…        containerd, CRI-O
 *     docker-pullable://nginx@sha256:…        dockershim
 *     sha256:…                                an image with no repo digest (built on the node)
 *
 * `''` when there is none yet -- a container still waiting to be pulled.
 */
export function digestOfImageID(imageID: string | undefined): string {
    if (!imageID) return '';
    const at = imageID.lastIndexOf('@');
    const candidate = at >= 0 ? imageID.slice(at + 1) : imageID.replace(/^[a-z-]+:\/\//, '');
    return DIGEST.test(candidate) ? candidate : '';
}

/**
 * How firmly a reference says which build runs:
 *
 * - `pinned`   -- a digest: the same bytes on every node, forever
 * - `tagged`   -- a version-looking tag: stable by convention, but a tag can be pushed again
 * - `floating` -- a tag that moves on purpose: `main`, `stable`, `nightly`, …
 * - `latest`   -- `:latest` written out
 * - `implicit` -- no tag at all, which is `:latest` by another name
 */
export type TagRisk = 'pinned' | 'tagged' | 'floating' | 'latest' | 'implicit';

const MOVING = new Set([
    'main',
    'master',
    'stable',
    'edge',
    'nightly',
    'dev',
    'develop',
    'development',
    'beta',
    'alpha',
    'canary',
    'current',
    'snapshot',
    'mainline',
    'rolling',
    'release',
    'head',
    'trunk',
    'unstable',
    'testing',
    'next',
]);

export function tagRisk(ref: ImageRef): TagRisk {
    if (ref.digest) return 'pinned';
    if (!ref.tag) return 'implicit';
    const tag = ref.tag.toLowerCase();
    if (tag === 'latest') return 'latest';
    if (MOVING.has(tag) || /(^|[-_.])(latest|snapshot|nightly)$/.test(tag)) return 'floating';
    return 'tagged';
}

/** Whether a reference leaves which build runs to when each node happened to pull it. */
export function isFloating(risk: TagRisk): boolean {
    return risk === 'latest' || risk === 'implicit' || risk === 'floating';
}

// ----- registries --------------------------------------------------------------

export interface RegistryInfo {
    /** What people call it: `Docker Hub`, `GitHub`, … or the host itself. */
    label: string;
    /** Frozen: it serves what it has but gets nothing new. */
    frozen: boolean;
    /** On this machine or this cluster's own network, rather than on the internet. */
    local: boolean;
}

const KNOWN: [RegExp, string][] = [
    [/^docker\.io$/, 'Docker Hub'],
    [/^ghcr\.io$/, 'GitHub'],
    [/^quay\.io$/, 'Quay'],
    [/^registry\.k8s\.io$/, 'Kubernetes'],
    [/^k8s\.gcr\.io$/, 'Kubernetes (legacy)'],
    [/^([a-z]+\.)?gcr\.io$/, 'Google GCR'],
    [/^[a-z0-9-]+-docker\.pkg\.dev$/, 'Artifact Registry'],
    [/^mcr\.microsoft\.com$/, 'Microsoft'],
    [/^public\.ecr\.aws$/, 'Amazon ECR Public'],
    [/^\d+\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/, 'Amazon ECR'],
    [/\.azurecr\.io$/, 'Azure ACR'],
    [/^registry\.gitlab\.com$/, 'GitLab'],
    [/^nvcr\.io$/, 'NVIDIA NGC'],
    [/^docker\.elastic\.co$/, 'Elastic'],
    [/^cgr\.dev$/, 'Chainguard'],
];

const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|[^.]+\.local|[^.:]+\.svc(\.cluster\.local)?|.*\.svc\.cluster\.local)(:\d+)?$/;

export function registryInfo(host: string): RegistryInfo {
    const lower = host.toLowerCase();
    const known = KNOWN.find(([pattern]) => pattern.test(lower));
    const local = LOCAL.test(lower) || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+(\.\d+)?(:\d+)?$/.test(lower);
    return {
        label: known ? known[1] : local ? 'Local registry' : host,
        // k8s.gcr.io stopped getting images in April 2023; registry.k8s.io replaced it.
        frozen: lower === 'k8s.gcr.io',
        local,
    };
}
