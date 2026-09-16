import { describe, expect, it } from 'vitest';
import {
    canonical,
    digestOfImageID,
    repositoryOfImageID,
    effectiveTag,
    familiar,
    familiarRepository,
    isFloating,
    parseImageRef,
    registryInfo,
    repositoryKey,
    shortDigest,
    tagRisk,
} from './image-ref';

const SHA = 'sha256:4c0fdaa8b6341bfdeca5f18f7837462c80cff90527ee35ef185571e1c327beac';

describe('parseImageRef', () => {
    const cases: [string, { registry: string; repository: string; tag: string; digest: string; implicitRegistry: boolean; implicitTag: boolean }][] = [
        ['nginx', { registry: 'docker.io', repository: 'library/nginx', tag: '', digest: '', implicitRegistry: true, implicitTag: true }],
        ['nginx:1.27', { registry: 'docker.io', repository: 'library/nginx', tag: '1.27', digest: '', implicitRegistry: true, implicitTag: false }],
        ['grafana/grafana:10.4.2', { registry: 'docker.io', repository: 'grafana/grafana', tag: '10.4.2', digest: '', implicitRegistry: true, implicitTag: false }],
        ['docker.io/nginx', { registry: 'docker.io', repository: 'library/nginx', tag: '', digest: '', implicitRegistry: false, implicitTag: true }],
        ['index.docker.io/library/redis:7', { registry: 'docker.io', repository: 'library/redis', tag: '7', digest: '', implicitRegistry: false, implicitTag: false }],
        ['registry-1.docker.io/bitnami/redis:7.2', { registry: 'docker.io', repository: 'bitnami/redis', tag: '7.2', digest: '', implicitRegistry: false, implicitTag: false }],
        ['ghcr.io/org/team/app:v1.2.3', { registry: 'ghcr.io', repository: 'org/team/app', tag: 'v1.2.3', digest: '', implicitRegistry: false, implicitTag: false }],
        ['localhost/tools', { registry: 'localhost', repository: 'tools', tag: '', digest: '', implicitRegistry: false, implicitTag: true }],
        ['localhost:5000/tools/cli', { registry: 'localhost:5000', repository: 'tools/cli', tag: '', digest: '', implicitRegistry: false, implicitTag: true }],
        ['registry.example.com:8443/team/api:2024-06-01', { registry: 'registry.example.com:8443', repository: 'team/api', tag: '2024-06-01', digest: '', implicitRegistry: false, implicitTag: false }],
        ['[::1]:5000/app:dev', { registry: '[::1]:5000', repository: 'app', tag: 'dev', digest: '', implicitRegistry: false, implicitTag: false }],
        [`nginx@${SHA}`, { registry: 'docker.io', repository: 'library/nginx', tag: '', digest: SHA, implicitRegistry: true, implicitTag: false }],
        [`quay.io/prometheus/node-exporter:v1.8.1@${SHA}`, { registry: 'quay.io', repository: 'prometheus/node-exporter', tag: 'v1.8.1', digest: SHA, implicitRegistry: false, implicitTag: false }],
        // A first component with no dot, no colon and not localhost is a Docker Hub namespace.
        ['myteam/app:1', { registry: 'docker.io', repository: 'myteam/app', tag: '1', digest: '', implicitRegistry: true, implicitTag: false }],
        // With no slash, a colon is a tag, never a port.
        ['myhost:5000', { registry: 'docker.io', repository: 'library/myhost', tag: '5000', digest: '', implicitRegistry: true, implicitTag: false }],
    ];

    for (const [raw, want] of cases) {
        it(`reads ${raw}`, () => {
            const ref = parseImageRef(raw);
            expect(ref.valid, ref.problem).toBe(true);
            expect({
                registry: ref.registry,
                repository: ref.repository,
                tag: ref.tag,
                digest: ref.digest,
                implicitRegistry: ref.implicitRegistry,
                implicitTag: ref.implicitTag,
            }).toEqual(want);
        });
    }

    it('treats a first component with an uppercase letter as a host, as distribution does', () => {
        const ref = parseImageRef('MyRegistry/app:1');
        expect(ref.registry).toBe('MyRegistry');
        expect(ref.repository).toBe('app');
    });

    it('keeps the reference as written', () => {
        expect(parseImageRef('  nginx:1 ').raw).toBe('  nginx:1 ');
    });

    it.each([
        ['', 'no image is named'],
        ['Nginx:1', 'repository names must be lowercase'],
        ['nginx:bad tag', 'it has a space in it'],
        ['nginx@sha256:short', 'is not a digest'],
        ['nginx:-bad', 'is not a valid tag'],
        ['ghcr.io/', 'no repository'],
    ])('refuses %j', (raw, problem) => {
        const ref = parseImageRef(raw);
        expect(ref.valid).toBe(false);
        expect(ref.problem).toContain(problem);
    });
});

describe('spelling a reference', () => {
    it('makes both spellings of one image the same key', () => {
        expect(canonical(parseImageRef('nginx'))).toBe('docker.io/library/nginx:latest');
        expect(canonical(parseImageRef('docker.io/library/nginx:latest'))).toBe('docker.io/library/nginx:latest');
        expect(canonical(parseImageRef(`nginx@${SHA}`))).toBe(`docker.io/library/nginx@${SHA}`);
        expect(canonical(parseImageRef(`nginx:1.27@${SHA}`))).toBe(`docker.io/library/nginx:1.27@${SHA}`);
    });

    it('writes it the familiar way', () => {
        expect(familiar(parseImageRef('docker.io/library/nginx:1.27'))).toBe('nginx:1.27');
        expect(familiar(parseImageRef('grafana/grafana:10'))).toBe('grafana/grafana:10');
        expect(familiar(parseImageRef('ghcr.io/org/app:v1'))).toBe('ghcr.io/org/app:v1');
        expect(familiar(parseImageRef(`ghcr.io/org/app@${SHA}`), { shortDigest: true })).toBe('ghcr.io/org/app@sha256:4c0fdaa8b634');
        expect(familiarRepository(parseImageRef('nginx:1'))).toBe('nginx');
        expect(repositoryKey(parseImageRef('nginx:1'))).toBe('docker.io/library/nginx');
    });

    it('knows the tag that is actually pulled', () => {
        expect(effectiveTag(parseImageRef('nginx'))).toBe('latest');
        expect(effectiveTag(parseImageRef('nginx:1'))).toBe('1');
        expect(effectiveTag(parseImageRef(`nginx@${SHA}`))).toBe('');
    });

    it('shortens a digest the way docker writes image ids', () => {
        expect(shortDigest(SHA)).toBe('sha256:4c0fdaa8b634');
        expect(shortDigest('abc')).toBe('abc');
    });
});

describe('digestOfImageID', () => {
    it.each([
        [`docker.io/library/nginx@${SHA}`, SHA],
        [`docker-pullable://nginx@${SHA}`, SHA],
        [SHA, SHA],
        [`docker://${SHA}`, SHA],
        ['', ''],
        [undefined, ''],
        ['nginx:1.27', ''],
    ])('reads %j', (imageID, want) => {
        expect(digestOfImageID(imageID)).toBe(want);
    });
});

describe('tagRisk', () => {
    it.each([
        ['nginx', 'implicit'],
        ['nginx:latest', 'latest'],
        ['nginx:LATEST', 'latest'],
        ['app:main', 'floating'],
        ['app:stable', 'floating'],
        ['app:v2-latest', 'floating'],
        ['app:nightly', 'floating'],
        ['app:1.2.3', 'tagged'],
        ['app:2024.06.01-abc123', 'tagged'],
        [`app@${SHA}`, 'pinned'],
        [`app:latest@${SHA}`, 'pinned'],
    ])('%s is %s', (raw, risk) => {
        expect(tagRisk(parseImageRef(raw))).toBe(risk);
    });

    it('calls latest, untagged and moving tags floating', () => {
        expect(isFloating('latest')).toBe(true);
        expect(isFloating('implicit')).toBe(true);
        expect(isFloating('floating')).toBe(true);
        expect(isFloating('tagged')).toBe(false);
        expect(isFloating('pinned')).toBe(false);
    });
});

describe('registryInfo', () => {
    it.each([
        ['docker.io', 'Docker Hub'],
        ['ghcr.io', 'GitHub'],
        ['quay.io', 'Quay'],
        ['registry.k8s.io', 'Kubernetes'],
        ['k8s.gcr.io', 'Kubernetes (legacy)'],
        ['eu.gcr.io', 'Google GCR'],
        ['europe-north1-docker.pkg.dev', 'Artifact Registry'],
        ['123456789012.dkr.ecr.eu-west-1.amazonaws.com', 'Amazon ECR'],
        ['myacr.azurecr.io', 'Azure ACR'],
        ['localhost:5000', 'Local registry'],
        ['registry.internal.example.com', 'registry.internal.example.com'],
    ])('names %s %s', (host, label) => {
        expect(registryInfo(host).label).toBe(label);
    });

    it('knows k8s.gcr.io is frozen', () => {
        expect(registryInfo('k8s.gcr.io').frozen).toBe(true);
        expect(registryInfo('registry.k8s.io').frozen).toBe(false);
    });

    it('knows what is local', () => {
        expect(registryInfo('localhost:5000').local).toBe(true);
        expect(registryInfo('192.168.1.20:5000').local).toBe(true);
        expect(registryInfo('registry.kube-system.svc.cluster.local:5000').local).toBe(true);
        expect(registryInfo('ghcr.io').local).toBe(false);
    });
});

describe('repositoryOfImageID', () => {
    it.each([
        [`docker.io/library/nginx@${SHA}`, 'docker.io/library/nginx'],
        [`docker-pullable://nginx@${SHA}`, 'docker.io/library/nginx'],
        [`docker.io/longhornio/csi-node-driver-registrar@${SHA}`, 'docker.io/longhornio/csi-node-driver-registrar'],
        [`registry.k8s.io/sig-storage/csi-attacher@${SHA}`, 'registry.k8s.io/sig-storage/csi-attacher'],
        [SHA, ''],
        [`docker://${SHA}`, ''],
        ['', ''],
        [undefined, ''],
    ])('%s -> %s', (imageID, want) => {
        expect(repositoryOfImageID(imageID)).toBe(want);
    });
});
