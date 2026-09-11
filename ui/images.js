// Built by scripts/build.mjs from src/ -- edit the TypeScript there, not this file.
"use strict";
(() => {
  // src/model/image-ref.ts
  var DOCKER_HUB = "docker.io";
  var HUB_ALIASES = /* @__PURE__ */ new Set(["index.docker.io", "registry-1.docker.io", "registry.hub.docker.com"]);
  var TAG = /^[\w][\w.-]{0,127}$/;
  var DIGEST = /^[a-z0-9]+(?:[.+_-][a-z0-9]+)*:[a-zA-Z0-9=_-]{32,}$/;
  var PATH_COMPONENT = /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/;
  function parseImageRef(raw) {
    const text = raw.trim();
    const ref = {
      raw,
      registry: DOCKER_HUB,
      repository: "",
      tag: "",
      digest: "",
      implicitRegistry: true,
      implicitTag: false,
      valid: true,
      problem: ""
    };
    const refuse = (problem) => {
      if (ref.valid) {
        ref.valid = false;
        ref.problem = problem;
      }
    };
    if (!text) {
      refuse("no image is named");
      return ref;
    }
    if (/\s/.test(text)) refuse("it has a space in it");
    let name = text;
    const at = name.indexOf("@");
    if (at >= 0) {
      ref.digest = name.slice(at + 1);
      name = name.slice(0, at);
      if (!DIGEST.test(ref.digest)) refuse(`"${ref.digest}" is not a digest`);
    }
    const colon = name.lastIndexOf(":");
    if (colon > name.lastIndexOf("/")) {
      ref.tag = name.slice(colon + 1);
      name = name.slice(0, colon);
      if (!TAG.test(ref.tag)) refuse(`"${ref.tag}" is not a valid tag`);
    }
    const slash = name.indexOf("/");
    const first = slash >= 0 ? name.slice(0, slash) : "";
    const isHost = slash >= 0 && (/[.:]/.test(first) || first === "localhost" || first !== first.toLowerCase());
    if (isHost) {
      ref.registry = HUB_ALIASES.has(first.toLowerCase()) ? DOCKER_HUB : first;
      ref.implicitRegistry = false;
      name = name.slice(slash + 1);
    }
    if (ref.registry === DOCKER_HUB && name && !name.includes("/")) name = "library/" + name;
    ref.repository = name;
    if (!name) refuse("it names a registry but no repository");
    else if (!name.split("/").every((part) => PATH_COMPONENT.test(part))) {
      refuse(name !== name.toLowerCase() ? "repository names must be lowercase" : `"${name}" is not a valid repository name`);
    }
    ref.implicitTag = !ref.tag && !ref.digest;
    return ref;
  }
  function effectiveTag(ref) {
    if (ref.tag) return ref.tag;
    return ref.digest ? "" : "latest";
  }
  function canonical(ref) {
    const tag = effectiveTag(ref);
    return `${ref.registry}/${ref.repository}${tag ? ":" + tag : ""}${ref.digest ? "@" + ref.digest : ""}`;
  }
  function repositoryKey(ref) {
    return `${ref.registry}/${ref.repository}`;
  }
  function familiarRepository(ref) {
    if (ref.registry !== DOCKER_HUB) return `${ref.registry}/${ref.repository}`;
    return ref.repository.startsWith("library/") ? ref.repository.slice("library/".length) : ref.repository;
  }
  function familiar(ref, opts = {}) {
    const digest = ref.digest ? "@" + (opts.shortDigest ? shortDigest(ref.digest) : ref.digest) : "";
    return familiarRepository(ref) + (ref.tag ? ":" + ref.tag : "") + digest;
  }
  function shortDigest(digest) {
    const cut = digest.indexOf(":");
    if (cut < 0) return digest.slice(0, 12);
    return digest.slice(0, cut + 1) + digest.slice(cut + 1, cut + 13);
  }
  function digestOfImageID(imageID) {
    if (!imageID) return "";
    const at = imageID.lastIndexOf("@");
    const candidate = at >= 0 ? imageID.slice(at + 1) : imageID.replace(/^[a-z-]+:\/\//, "");
    return DIGEST.test(candidate) ? candidate : "";
  }
  var MOVING = /* @__PURE__ */ new Set([
    "main",
    "master",
    "stable",
    "edge",
    "nightly",
    "dev",
    "develop",
    "development",
    "beta",
    "alpha",
    "canary",
    "current",
    "snapshot",
    "mainline",
    "rolling",
    "release",
    "head",
    "trunk",
    "unstable",
    "testing",
    "next"
  ]);
  function tagRisk(ref) {
    if (ref.digest) return "pinned";
    if (!ref.tag) return "implicit";
    const tag = ref.tag.toLowerCase();
    if (tag === "latest") return "latest";
    if (MOVING.has(tag) || /(^|[-_.])(latest|snapshot|nightly)$/.test(tag)) return "floating";
    return "tagged";
  }
  function isFloating(risk) {
    return risk === "latest" || risk === "implicit" || risk === "floating";
  }
  var KNOWN = [
    [/^docker\.io$/, "Docker Hub"],
    [/^ghcr\.io$/, "GitHub"],
    [/^quay\.io$/, "Quay"],
    [/^registry\.k8s\.io$/, "Kubernetes"],
    [/^k8s\.gcr\.io$/, "Kubernetes (legacy)"],
    [/^([a-z]+\.)?gcr\.io$/, "Google GCR"],
    [/^[a-z0-9-]+-docker\.pkg\.dev$/, "Artifact Registry"],
    [/^mcr\.microsoft\.com$/, "Microsoft"],
    [/^public\.ecr\.aws$/, "Amazon ECR Public"],
    [/^\d+\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/, "Amazon ECR"],
    [/\.azurecr\.io$/, "Azure ACR"],
    [/^registry\.gitlab\.com$/, "GitLab"],
    [/^nvcr\.io$/, "NVIDIA NGC"],
    [/^docker\.elastic\.co$/, "Elastic"],
    [/^cgr\.dev$/, "Chainguard"]
  ];
  var LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|[^.]+\.local|[^.:]+\.svc(\.cluster\.local)?|.*\.svc\.cluster\.local)(:\d+)?$/;
  function registryInfo(host) {
    const lower = host.toLowerCase();
    const known = KNOWN.find(([pattern]) => pattern.test(lower));
    const local = LOCAL.test(lower) || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+(\.\d+)?(:\d+)?$/.test(lower);
    return {
      label: known ? known[1] : local ? "Local registry" : host,
      // k8s.gcr.io stopped getting images in April 2023; registry.k8s.io replaced it.
      frozen: lower === "k8s.gcr.io",
      local
    };
  }

  // src/model/kube.ts
  var APP_KINDS = {
    Deployment: "deployments",
    StatefulSet: "statefulsets",
    DaemonSet: "daemonsets",
    ReplicaSet: "replicasets",
    Job: "jobs",
    CronJob: "cronjobs",
    Pod: "pods"
  };
  function controllerOf(obj) {
    const owners = obj.metadata.ownerReferences ?? [];
    return owners.find((o) => o.controller) ?? owners[0] ?? null;
  }
  function eventTime(ev) {
    const raw = ev.series?.lastObservedTime || ev.lastTimestamp || ev.eventTime || ev.firstTimestamp || ev.metadata.creationTimestamp || "";
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : 0;
  }

  // src/model/pull.ts
  var PULL_REASONS = /* @__PURE__ */ new Set([
    "ErrImagePull",
    "ImagePullBackOff",
    "InvalidImageName",
    "ErrImageNeverPull",
    "RegistryUnavailable",
    "ErrImageInspect",
    "SignatureValidationFailed"
  ]);
  function isPullReason(reason) {
    return !!reason && PULL_REASONS.has(reason);
  }
  var BACKOFF_ONLY = /^back-off pulling image/i;
  var RULES = [
    {
      cause: "ratelimit",
      test: /toomanyrequests|too many requests|rate limit|\b429\b/,
      title: "The registry is rate-limiting pulls",
      hint: "Docker Hub limits anonymous pulls per IP. Pull with credentials (an imagePullSecret), or mirror the image into a registry you run."
    },
    {
      cause: "platform",
      test: /no match for platform|exec format error|does not match the specified platform/,
      title: "There is no build of this image for the node's CPU",
      hint: "The image was not published for this architecture (arm64 or amd64). Build a multi-arch image, or keep the pod off these nodes."
    },
    {
      cause: "missing-or-private",
      test: /pull access denied|repository does not exist or may require/,
      title: "The repository does not exist, or it is private",
      hint: "The registry gives the same answer for both. Check the name for a typo; if it is private, the pod needs an imagePullSecret that can read it."
    },
    {
      cause: "missing",
      test: /manifest unknown|not found|name unknown|no such image|does not exist|\b404\b/,
      title: "That tag does not exist in the registry",
      hint: "The repository answered, but not with this tag. Check the tag was pushed -- a CI job that failed, or a typo in the version."
    },
    {
      cause: "auth",
      test: /unauthorized|authentication required|denied|forbidden|insufficient_scope|no basic auth credentials|\b40[13]\b/,
      title: "The registry refused the credentials",
      hint: "Check the pod's imagePullSecrets (or its service account's) exist in this namespace and are still valid. Expired tokens are the usual cause."
    },
    {
      cause: "tls",
      test: /x509|certificate signed by unknown authority|certificate is not valid|tls: /,
      title: "The node does not trust the registry's certificate",
      hint: "Install the registry's CA on the nodes, or configure the runtime to trust it. HTTPS to a private registry is the usual case."
    },
    {
      cause: "network",
      test: /no such host|dial tcp|i\/o timeout|connection refused|connection reset|context deadline exceeded|network is unreachable|server misbehaving|\beof\b|service unavailable|\b50[234]\b/,
      title: "The node could not reach the registry",
      hint: "A DNS name that does not resolve, a proxy or firewall in the way, or the registry being down. Try pulling from the node itself."
    }
  ];
  function diagnosePull(reason, messages) {
    const useful = messages.map((m) => m.trim()).filter((m) => m && !BACKOFF_ONLY.test(m));
    const evidence = useful[0] ?? messages.find((m) => m.trim()) ?? "";
    if (reason === "InvalidImageName") {
      return {
        cause: "invalid",
        title: "The image name is not valid",
        hint: "A runtime cannot read this reference at all: an uppercase letter, a stray space, or a tag with characters tags cannot have.",
        evidence
      };
    }
    if (reason === "ErrImageNeverPull") {
      return {
        cause: "never",
        title: "The pod may not pull, and the image is not on the node",
        hint: "imagePullPolicy is Never, so the image has to be loaded onto every node that might run the pod -- or the policy changed to IfNotPresent.",
        evidence
      };
    }
    const text = useful.join("\n").toLowerCase().replace(/[a-z0-9]+:[a-f0-9]{32,}/g, "");
    for (const rule of RULES) {
      if (rule.test.test(text)) return { cause: rule.cause, title: rule.title, hint: rule.hint, evidence };
    }
    return {
      cause: "unknown",
      title: "The image could not be pulled",
      hint: useful.length ? "The node gave the reason below." : "The kubelet is backing off between attempts; the reason is in the pod’s events from the first attempt.",
      evidence
    };
  }

  // src/model/inventory.ts
  var TONE_RANK = { error: 0, warn: 1, info: 2, muted: 3, ok: 4 };
  function worse(a, b) {
    return TONE_RANK[a] <= TONE_RANK[b] ? a : b;
  }
  var STARTING = /* @__PURE__ */ new Set(["ContainerCreating", "PodInitializing", ""]);
  function ownerIndex(list) {
    const out = /* @__PURE__ */ new Map();
    for (const obj of list ?? []) out.set(`${obj.metadata.namespace ?? ""}/${obj.metadata.name}`, controllerOf(obj));
    return out;
  }
  function workloadRef(kind, namespace, name) {
    return { kind, appKind: APP_KINDS[kind] ?? "", namespace, name, key: `${kind}/${namespace}/${name}` };
  }
  function resolveWorkload(pod, replicaSetOwners, jobOwners) {
    const ns = pod.metadata.namespace ?? "";
    const owner = controllerOf(pod);
    if (!owner || owner.kind === "Node") return workloadRef("Pod", ns, pod.metadata.name);
    if (owner.kind === "ReplicaSet") {
      const key = `${ns}/${owner.name}`;
      const up = replicaSetOwners.get(key);
      if (up) return workloadRef(up.kind, ns, up.name);
      const hash2 = pod.metadata.labels?.["pod-template-hash"];
      if (!replicaSetOwners.has(key) && hash2 && owner.name.endsWith("-" + hash2)) {
        return workloadRef("Deployment", ns, owner.name.slice(0, -hash2.length - 1));
      }
    }
    if (owner.kind === "Job") {
      const up = jobOwners.get(`${ns}/${owner.name}`);
      if (up && up.kind === "CronJob") return workloadRef("CronJob", ns, up.name);
    }
    return workloadRef(owner.kind, ns, owner.name);
  }
  function containerOfFieldPath(fieldPath) {
    const m = /\{([^}]+)\}/.exec(fieldPath ?? "");
    return m?.[1] ?? "";
  }
  function pullEvents(events) {
    const best = /* @__PURE__ */ new Map();
    for (const ev of events ?? []) {
      const obj = ev.involvedObject;
      if (!obj || obj.kind !== "Pod" || !obj.name) continue;
      const message2 = ev.message ?? "";
      if (!/image/i.test(message2)) continue;
      if (!/^(Failed|BackOff|ErrImageNeverPull|InspectFailed)$/.test(ev.reason ?? "")) continue;
      const key = `${obj.namespace ?? ev.metadata.namespace ?? ""}/${obj.name}/${containerOfFieldPath(obj.fieldPath)}`;
      const score = /^back-off pulling image/i.test(message2) ? 0 : 1;
      const t = eventTime(ev);
      const have = best.get(key);
      if (!have || score > have.score || score === have.score && t > have.t) best.set(key, { message: message2, score, t });
    }
    const out = /* @__PURE__ */ new Map();
    for (const [key, value] of best) out.set(key, value.message);
    return out;
  }
  function podUse(pod, container, init, eventMessages) {
    const ns = pod.metadata.namespace ?? "";
    const phase = pod.status?.phase ?? "Pending";
    const statuses = (init ? pod.status?.initContainerStatuses : pod.status?.containerStatuses) ?? [];
    const status = statuses.find((s) => s.name === container.name);
    const st = status?.state ?? {};
    const state2 = st.running ? "running" : st.waiting ? "waiting" : st.terminated ? "terminated" : "unknown";
    const reason = st.waiting?.reason ?? st.terminated?.reason ?? "";
    const message2 = st.waiting?.message ?? st.terminated?.message ?? "";
    let ready;
    if (init) {
      ready = !!st.terminated && (st.terminated.exitCode ?? 1) === 0 || !!st.running && status?.started !== false;
    } else {
      ready = !!status?.ready;
    }
    return {
      namespace: ns,
      pod: pod.metadata.name,
      node: pod.spec?.nodeName ?? "",
      container: container.name,
      init,
      phase,
      finished: phase === "Succeeded" || phase === "Failed",
      ready,
      state: state2,
      reason,
      message: message2,
      restarts: status?.restartCount ?? 0,
      digest: digestOfImageID(status?.imageID),
      pullError: state2 === "waiting" && isPullReason(reason),
      eventMessage: eventMessages.get(`${ns}/${pod.metadata.name}/${container.name}`) ?? ""
    };
  }
  function isUnwell(use) {
    if (use.finished || use.pullError || use.ready) return false;
    if (use.init && use.state === "unknown") return false;
    if (use.state === "waiting" && STARTING.has(use.reason)) return false;
    if (use.state === "unknown") return false;
    return true;
  }
  function templateContainers(template) {
    const spec = template?.spec;
    return [
      ...(spec?.initContainers ?? []).map((container) => ({ container, init: true })),
      ...(spec?.containers ?? []).map((container) => ({ container, init: false }))
    ];
  }
  function buildInventory(data) {
    const builders = /* @__PURE__ */ new Map();
    const rsOwners = ownerIndex(data.replicasets);
    const jobOwners = ownerIndex(data.jobs);
    const eventMessages = pullEvents(data.events);
    function entryFor(image) {
      const ref = parseImageRef(image);
      const key = ref.valid ? canonical(ref) : image.trim();
      let b = builders.get(key);
      if (!b) {
        b = { key, ref, spellings: /* @__PURE__ */ new Set(), usages: /* @__PURE__ */ new Map() };
        builders.set(key, b);
      }
      b.spellings.add(image.trim());
      return b;
    }
    function usageFor(b, workload, container, init) {
      const key = `${workload.key}/${init ? "init:" : ""}${container.name}`;
      let u = b.usages.get(key);
      if (!u) {
        u = { workload, container: container.name, init, declared: false, pullPolicy: container.imagePullPolicy ?? "", pods: [] };
        b.usages.set(key, u);
      }
      return u;
    }
    function declare(kind, obj, template) {
      const workload = workloadRef(kind, obj.metadata.namespace ?? "", obj.metadata.name);
      for (const { container, init } of templateContainers(template)) {
        if (!container.image) continue;
        usageFor(entryFor(container.image), workload, container, init).declared = true;
      }
    }
    for (const d of data.deployments ?? []) declare("Deployment", d, d.spec?.template);
    for (const s of data.statefulsets ?? []) declare("StatefulSet", s, s.spec?.template);
    for (const d of data.daemonsets ?? []) declare("DaemonSet", d, d.spec?.template);
    for (const c of data.cronjobs ?? []) declare("CronJob", c, c.spec?.jobTemplate?.spec?.template);
    for (const j of data.jobs ?? []) {
      if (controllerOf(j)?.kind !== "CronJob") declare("Job", j, j.spec?.template);
    }
    for (const pod of data.pods) {
      const workload = resolveWorkload(pod, rsOwners, jobOwners);
      for (const { container, init } of templateContainers({ spec: pod.spec })) {
        if (!container.image) continue;
        const b = entryFor(container.image);
        usageFor(b, workload, container, init).pods.push(podUse(pod, container, init, eventMessages));
      }
    }
    const images = [...builders.values()].map(finish);
    images.sort(byConcern);
    return {
      images,
      registries: groupRegistries(images),
      namespaces: groupNamespaces(images),
      totals: totalsOf(images),
      signature: signatureOf(images)
    };
  }
  function finish(b) {
    const ref = b.ref;
    const risk = tagRisk(ref);
    const usages = [...b.usages.values()];
    for (const u of usages) u.pods.sort((a, c) => a.pod.localeCompare(c.pod));
    usages.sort(
      (a, c) => live(c.pods).length - live(a.pods).length || a.workload.namespace.localeCompare(c.workload.namespace) || a.workload.name.localeCompare(c.workload.name) || a.container.localeCompare(c.container)
    );
    const pods = usages.flatMap((u) => u.pods);
    const running = live(pods);
    const namespaces = [...new Set(usages.map((u) => u.workload.namespace))].sort();
    const digestCount = /* @__PURE__ */ new Map();
    for (const p of running) if (p.digest) digestCount.set(p.digest, (digestCount.get(p.digest) ?? 0) + 1);
    const digests = [...digestCount.entries()].sort((a, c) => c[1] - a[1] || a[0].localeCompare(c[0])).map(([d]) => d);
    const pulling = running.filter((p) => p.pullError);
    const unwell = running.filter(isUnwell);
    const issues = [];
    const name = familiar(ref);
    if (!ref.valid) {
      issues.push({ kind: "invalid", tone: "error", label: "Invalid name", text: `"${ref.raw.trim()}" is not an image reference a runtime will accept: ${ref.problem}.` });
    }
    if (pulling.length) {
      const first = pulling.find((p) => p.message && !/^back-off/i.test(p.message)) ?? pulling[0];
      const messages = [...pulling.map((p) => p.message), ...pulling.map((p) => p.eventMessage)];
      const diagnosis = diagnosePull(first.reason, messages);
      issues.push({
        kind: "pull",
        tone: "error",
        label: first.reason === "ImagePullBackOff" || first.reason === "ErrImagePull" ? "Pull failing" : first.reason,
        text: `${count(pulling.length, "container")} of ${running.length} cannot pull it: ${lowerFirst(diagnosis.title)}.`,
        diagnosis
      });
    }
    if (unwell.length) {
      const reasons = [...new Set(unwell.map((p) => p.reason || (p.state === "running" ? "not ready" : p.state)))];
      issues.push({
        kind: "not-ready",
        tone: "warn",
        label: "Not ready",
        text: `${count(unwell.length, "container")} of ${running.length} running it ${unwell.length === 1 ? "is" : "are"} not ready (${reasons.join(", ")}).`
      });
    }
    if (!ref.digest && digests.length > 1) {
      issues.push({
        kind: "drift",
        tone: "warn",
        label: `${digests.length} builds`,
        text: `Pods run ${digests.length} different builds of this tag (${digests.map(shortDigest).join(", ")}): it was pushed again after some nodes pulled it.`
      });
    }
    if (ref.valid && risk === "implicit") {
      issues.push({ kind: "implicit", tone: "warn", label: "Untagged", text: `No tag is written, so every node pulls whatever ${name}:latest is at the time.` });
    } else if (ref.valid && risk === "latest") {
      issues.push({ kind: "latest", tone: "warn", label: ":latest", text: "Which build runs depends on when each node pulled :latest." });
    } else if (ref.valid && risk === "floating") {
      issues.push({ kind: "floating", tone: "warn", label: "Moving tag", text: `:${ref.tag} is moved on purpose, so which build runs depends on when each node pulled it.` });
    }
    if (registryInfo(ref.registry).frozen) {
      issues.push({ kind: "frozen", tone: "warn", label: "Frozen registry", text: `${ref.registry} gets no new images since April 2023; the same images are on registry.k8s.io.` });
    }
    if (ref.valid && risk === "tagged") {
      issues.push({ kind: "unpinned", tone: "info", label: "Not pinned", text: "Tagged but not pinned by digest: a push to the same tag changes what the next pod runs." });
    }
    if (!running.length) {
      const who = usages.find((u) => u.declared)?.workload;
      issues.push({
        kind: "idle",
        tone: "muted",
        label: "Not running",
        text: who ? who.kind === "CronJob" ? `Declared by CronJob ${who.name}; nothing runs it between jobs.` : `Declared by ${who.kind} ${who.name}, which has no pods running it.` : "Only finished pods ran it."
      });
    }
    issues.sort((a, c) => TONE_RANK[a.tone] - TONE_RANK[c.tone]);
    let tone = running.length ? "ok" : "muted";
    for (const i of issues) if (i.tone === "error" || i.tone === "warn") tone = worse(tone, i.tone);
    return {
      key: b.key,
      ref,
      risk,
      spellings: [...b.spellings].sort(),
      usages,
      namespaces,
      containers: running.length,
      ready: running.filter((p) => p.ready).length,
      pulling: pulling.length,
      digests,
      issues,
      tone,
      running: running.length > 0
    };
  }
  function live(pods) {
    return pods.filter((p) => !p.finished);
  }
  function count(n, one, many = one + "s") {
    return `${n} ${n === 1 ? one : many}`;
  }
  function lowerFirst(s) {
    return s.charAt(0).toLowerCase() + s.slice(1);
  }
  function byConcern(a, b) {
    return TONE_RANK[a.tone] - TONE_RANK[b.tone] || b.containers - a.containers || a.key.localeCompare(b.key);
  }
  function groupRegistries(images) {
    const byRegistry = /* @__PURE__ */ new Map();
    for (const image of images) {
      const repos = byRegistry.get(image.ref.registry) ?? /* @__PURE__ */ new Map();
      byRegistry.set(image.ref.registry, repos);
      const key = repositoryKey(image.ref);
      repos.set(key, [...repos.get(key) ?? [], image]);
    }
    const groups = [];
    for (const [registry, repos] of byRegistry) {
      const repositories = [...repos.entries()].map(([key, list]) => {
        list.sort(byConcern);
        const first = list[0];
        return {
          key,
          registry,
          repository: first.ref.repository,
          familiar: familiar({ ...first.ref, tag: "", digest: "" }),
          images: list,
          containers: list.reduce((n, i) => n + i.containers, 0),
          tone: list.reduce((t, i) => worse(t, i.tone), "ok")
        };
      });
      repositories.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || b.containers - a.containers || a.key.localeCompare(b.key));
      const info = registryInfo(registry);
      groups.push({
        registry,
        label: info.label,
        frozen: info.frozen,
        local: info.local,
        repositories,
        images: repositories.reduce((n, r) => n + r.images.length, 0),
        containers: repositories.reduce((n, r) => n + r.containers, 0),
        tone: repositories.reduce((t, r) => worse(t, r.tone), "ok"),
        colour: 0
      });
    }
    groups.sort((a, b) => b.images - a.images || b.containers - a.containers || a.registry.localeCompare(b.registry));
    groups.forEach((g, i) => g.colour = Math.min(i, 7));
    return groups;
  }
  function groupNamespaces(images) {
    const byNs = /* @__PURE__ */ new Map();
    for (const image of images) {
      for (const u of image.usages) {
        const ns = u.workload.namespace;
        let entry = byNs.get(ns);
        if (!entry) {
          entry = { images: /* @__PURE__ */ new Set(), containers: 0, tone: "ok", workloads: /* @__PURE__ */ new Map() };
          byNs.set(ns, entry);
        }
        const running = live(u.pods).length;
        entry.images.add(image.key);
        entry.containers += running;
        entry.tone = worse(entry.tone, image.tone === "muted" ? "ok" : image.tone);
        let w = entry.workloads.get(u.workload.key);
        if (!w) {
          w = { workload: u.workload, images: /* @__PURE__ */ new Set(), containers: 0 };
          entry.workloads.set(u.workload.key, w);
        }
        w.images.add(image.key);
        w.containers += running;
      }
    }
    const out = [...byNs.entries()].map(([namespace, e]) => ({
      namespace,
      images: e.images.size,
      containers: e.containers,
      tone: e.tone,
      workloads: [...e.workloads.values()].map((w) => ({ workload: w.workload, images: w.images.size, containers: w.containers })).sort((a, b) => b.images - a.images || b.containers - a.containers || a.workload.name.localeCompare(b.workload.name))
    }));
    out.sort((a, b) => b.images - a.images || b.containers - a.containers || a.namespace.localeCompare(b.namespace));
    return out;
  }
  function totalsOf(images) {
    const has = (i, kind) => i.issues.some((x) => x.kind === kind);
    const pods = /* @__PURE__ */ new Set();
    const namespaces = /* @__PURE__ */ new Set();
    for (const i of images) {
      for (const u of i.usages) {
        namespaces.add(u.workload.namespace);
        for (const p of u.pods) if (!p.finished) pods.add(`${p.namespace}/${p.pod}`);
      }
    }
    return {
      images: images.length,
      running: images.filter((i) => i.running).length,
      registries: new Set(images.map((i) => i.ref.registry)).size,
      namespaces: namespaces.size,
      containers: images.reduce((n, i) => n + i.containers, 0),
      pods: pods.size,
      pinned: images.filter((i) => i.risk === "pinned").length,
      floating: images.filter((i) => isFloating(i.risk)).length,
      pullFailing: images.filter((i) => has(i, "pull")).length,
      pullContainers: images.reduce((n, i) => n + i.pulling, 0),
      notReady: images.filter((i) => has(i, "not-ready")).length,
      drift: images.filter((i) => has(i, "drift")).length,
      idle: images.filter((i) => !i.running).length,
      attention: images.filter((i) => i.tone === "error" || i.tone === "warn").length
    };
  }
  function fingerprint(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }
  function signatureOf(images) {
    return fingerprint(
      JSON.stringify(
        images.map((i) => [
          i.key,
          i.tone,
          i.issues.map((x) => x.kind + x.text),
          i.usages.map((u) => [u.workload.key, u.container, u.init, u.declared, u.pods.map((p) => [p.pod, p.node, p.ready, p.state, p.reason, p.restarts, p.digest, p.finished])])
        ])
      )
    );
  }

  // src/model/feed.ts
  var SLOW_KINDS = ["deployments", "statefulsets", "daemonsets", "replicasets", "jobs", "cronjobs", "events"];
  function listPrint(items) {
    return fingerprint(items.map((o) => `${o.metadata.uid ?? o.metadata.namespace + "/" + o.metadata.name}@${o.metadata.resourceVersion ?? ""}`).join("|"));
  }
  function startFeed(bridge, opts) {
    const state2 = { data: { pods: [] }, errors: {}, ready: false };
    const prints = /* @__PURE__ */ new Map();
    const stops = [];
    function accept(kind, items) {
      const print = listPrint(items);
      const hadError = kind in state2.errors;
      delete state2.errors[kind];
      if (prints.get(kind) === print && !hadError && (kind !== "pods" || state2.ready)) return;
      prints.set(kind, print);
      switch (kind) {
        case "pods":
          state2.data.pods = items;
          state2.ready = true;
          break;
        case "jobs":
          state2.data.jobs = items;
          break;
        case "cronjobs":
          state2.data.cronjobs = items;
          break;
        case "events":
          state2.data.events = items;
          break;
        default:
          state2.data[kind] = items;
      }
      opts.onChange(state2);
    }
    function refuse(kind, err) {
      if (state2.errors[kind] === err.message) return;
      state2.errors[kind] = err.message;
      opts.onChange(state2);
    }
    const watch = (kind, interval) => {
      stops.push(
        bridge.watch(
          { kind, namespace: opts.namespace ?? "", interval },
          (items) => accept(kind, items),
          (err) => refuse(kind, err)
        )
      );
    };
    watch("pods", opts.fast ?? 5e3);
    for (const kind of SLOW_KINDS) watch(kind, opts.slow ?? 15e3);
    return () => stops.forEach((stop) => stop());
  }

  // src/ui/icons.ts
  var ICONS = {
    // Stacked layers: an image is its layers.
    logo: ["M12 3.2 3.5 7.6 12 12l8.5-4.4z", "M3.5 12 12 16.4l8.5-4.4", "M3.5 16.4 12 20.8l8.5-4.4"],
    registry: ["M4 6.5c0-1.4 3.6-2.5 8-2.5s8 1.1 8 2.5-3.6 2.5-8 2.5-8-1.1-8-2.5z", "M4 6.5v11c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-11", "M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5"],
    repo: ["M20 8 12 4 4 8v8l8 4 8-4z", "M4 8l8 4 8-4", "M12 12v8"],
    tag: ["M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7.3 7.3a1 1 0 0 1-1.4 0z", "M8 8h.01"],
    digest: ["M9 3.5 7 20.5", "M17 3.5l-2 17", "M4 8.5h16", "M3.5 15.5h16"],
    pin: ["M9 4h6", "M10 4l-.5 7-3 2.5h11l-3-2.5-.5-7", "M12 13.5V20"],
    lock: ["M6 10.5h12v9.5H6z", "M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"],
    unlock: ["M6 10.5h12v9.5H6z", "M8.5 10.5V7.5a3.5 3.5 0 0 1 6.8-1.2"],
    pod: ["M12 3l8 4.5v9L12 21l-8-4.5v-9z", "M12 12l8-4.5", "M12 12v9", "M12 12L4 7.5"],
    deployment: ["M3 7l9-4 9 4-9 4-9-4z", "M3 12l9 4 9-4", "M3 17l9 4 9-4"],
    statefulset: ["M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z", "M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6", "M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"],
    daemonset: ["M17 2l4 4-4 4", "M3 11V9a4 4 0 0 1 4-4h14", "M7 22l-4-4 4-4", "M21 13v2a4 4 0 0 1-4 4H3"],
    cronjob: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 7v5l3 2"],
    job: ["M9 11.5l2.5 2.5L20 5.5", "M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"],
    replicaset: ["M9 4h11v11", "M4 9h11v11H4z"],
    owner: ["M4 5h7v14H4z", "M15 12h5", "M17.5 9.5l2.5 2.5-2.5 2.5"],
    container: ["M4 7h16v11H4z", "M4 7l2-3h12l2 3", "M9 11h6"],
    init: ["M5 12h9", "M11 8l4 4-4 4", "M19 5v14"],
    node: ["M4 5h16v5H4z", "M4 14h16v5H4z", "M7.5 7.5h.01", "M7.5 16.5h.01"],
    alert: ["M12 3.5l9.5 17h-19z", "M12 10v4", "M12 17.2h.01"],
    failed: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M9 9l6 6", "M15 9l-6 6"],
    check: ["M4.5 12.5l5 5L19.5 7"],
    close: ["M6.5 6.5l11 11", "M17.5 6.5l-11 11"],
    info: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 11v6", "M12 7.5h.01"],
    clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5l3.2 2"],
    moving: ["M4 12h11", "M11 7l5 5-5 5", "M20 5v14"],
    search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M20 20l-4-4"],
    open: ["M14 4h6v6", "M20 4l-9 9", "M18 14v6H4V6h6"],
    chevron: ["M9.5 6l6 6-6 6"],
    "chevron-down": ["M6 9.5l6 6 6-6"],
    restart: ["M20.5 12a8.5 8.5 0 1 1-2.6-6.1", "M20.5 4v5h-5"],
    logs: ["M4 5h16v14H4z", "M7.5 9.5l2.5 2.5-2.5 2.5", "M13 15h4"],
    edit: ["M4 20h4L19 9l-4-4L4 16z", "M14 6l4 4"],
    chart: ["M4 4v16h16", "M8 15l3-4 3 2 5-6"],
    rank: ["M6 20v-5", "M12 20V9", "M18 20V4"],
    users: ["M9 5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z", "M2.5 20a6.5 6.5 0 0 1 13 0", "M16 5.3a3.5 3.5 0 0 1 0 6.4", "M18 14.3a6.5 6.5 0 0 1 3.5 5.7"],
    namespace: ["M4 6h6l2 2h8v10H4z"],
    globe: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M3 12h18", "M12 3a14 14 0 0 1 0 18", "M12 3a14 14 0 0 0 0 18"],
    book: ["M12 6.5c-1.5-1.3-3.8-2-7-2v13c3.2 0 5.5.7 7 2 1.5-1.3 3.8-2 7-2v-13c-3.2 0-5.5.7-7 2z", "M12 6.5v13"],
    link: ["M10.5 13.5a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7l-1.2 1.2", "M13.5 10.5a4 4 0 0 0-5.7 0l-2.3 2.3a4 4 0 0 0 5.7 5.7l1.2-1.2"],
    filter: ["M4 5h16l-6 7.5V19l-4 1.5v-8z"],
    grid: ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M13 13h7v7h-7z"],
    snowflake: ["M12 3v18", "M4.2 7.5l15.6 9", "M4.2 16.5l15.6-9", "M9.5 4.5 12 7l2.5-2.5", "M9.5 19.5 12 17l2.5 2.5"],
    dot: ["M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"]
  };
  function kindIcon(kind) {
    switch (kind) {
      case "Deployment":
        return "deployment";
      case "StatefulSet":
        return "statefulset";
      case "DaemonSet":
        return "daemonset";
      case "CronJob":
        return "cronjob";
      case "Job":
        return "job";
      case "ReplicaSet":
        return "replicaset";
      case "Pod":
        return "pod";
      default:
        return "owner";
    }
  }

  // src/ui/dom.ts
  var SVG_NS = "http://www.w3.org/2000/svg";
  function el(tag, className = "", text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== void 0) node.textContent = String(text);
    return node;
  }
  function add(parent, ...children) {
    for (const child of children) {
      if (child === null || child === void 0 || child === false) continue;
      parent.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return parent;
  }
  function svg(tag, attrs = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  }
  function clear(node) {
    node.textContent = "";
  }
  function byId(id) {
    const node = document.getElementById(id);
    if (!node) throw new Error(`the page has no #${id}`);
    return node;
  }
  function icon(name, className = "") {
    const node = svg("svg", { viewBox: "0 0 24 24", class: "ico" + (className ? " " + className : ""), "aria-hidden": "true" });
    for (const d of ICONS[name]) node.appendChild(svg("path", { d }));
    return node;
  }
  function chip(text, tone = "", iconName, title) {
    const node = el("span", "chip" + (tone ? " " + tone : ""));
    if (iconName) node.appendChild(icon(iconName));
    node.appendChild(el("span", "", text));
    if (title) node.title = title;
    return node;
  }
  function button(text, className, iconName, onClick) {
    const node = el("button", className);
    node.type = "button";
    if (iconName) node.appendChild(icon(iconName));
    if (text) node.appendChild(el("span", "", text));
    node.addEventListener("click", onClick);
    return node;
  }
  function iconButton(iconName, label, onClick, className = "") {
    const node = button("", "icon-button" + (className ? " " + className : ""), iconName, onClick);
    node.title = label;
    node.setAttribute("aria-label", label);
    return node;
  }
  function linkButton(text, onClick, title) {
    const node = el("button", "link", text);
    node.type = "button";
    if (title) node.title = title;
    node.addEventListener("click", onClick);
    return node;
  }

  // src/ui/format.ts
  function plural(n, one, many = one + "s") {
    return `${n} ${n === 1 ? one : many}`;
  }

  // src/ui/page.ts
  var sdk = k8sdockside;
  function message(err) {
    return err instanceof Error ? err.message : String(err);
  }
  var banner = {
    show(err) {
      const node = byId("error");
      node.textContent = message(err);
      node.hidden = false;
    },
    clear() {
      byId("error").hidden = true;
    }
  };
  function every(ms, fn, onError = banner.show) {
    let stopped = false;
    let timer;
    const run = () => {
      Promise.resolve().then(fn).catch((err) => {
        if (!stopped) onError(err);
      }).then(() => {
        if (!stopped) timer = setTimeout(run, ms);
      });
    };
    run();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }
  function readHash() {
    const out = {};
    for (const pair of location.hash.replace(/^#/, "").split("&")) {
      const cut = pair.indexOf("=");
      if (cut <= 0) continue;
      try {
        out[pair.slice(0, cut)] = decodeURIComponent(pair.slice(cut + 1));
      } catch {
      }
    }
    return out;
  }
  function writeHash(values) {
    const text = Object.entries(values).filter((entry) => typeof entry[1] === "string" && entry[1] !== "").map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    const hash2 = text ? "#" + text : "";
    if (hash2 === location.hash || !hash2 && !location.hash) return;
    try {
      history.replaceState(null, "", hash2 || location.pathname);
    } catch {
      try {
        location.hash = text;
      } catch {
      }
    }
  }
  function politely(root, redraw) {
    let pressed = false;
    let owed = false;
    const busy = () => {
      if (pressed) return true;
      const active = document.activeElement;
      if (active && root.contains(active) && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) return true;
      const selection = document.getSelection();
      if (selection && !selection.isCollapsed && selection.anchorNode && root.contains(selection.anchorNode)) return true;
      return false;
    };
    const settle = () => {
      if (owed && !busy()) {
        owed = false;
        keepFocus(root, redraw);
      }
    };
    root.addEventListener("pointerdown", () => pressed = true);
    window.addEventListener("pointerup", () => {
      pressed = false;
      setTimeout(settle, 0);
    });
    window.addEventListener("pointercancel", () => {
      pressed = false;
      settle();
    });
    root.addEventListener("focusout", () => setTimeout(settle, 0));
    document.addEventListener("selectionchange", () => {
      if (owed) setTimeout(settle, 0);
    });
    return () => {
      if (busy()) owed = true;
      else keepFocus(root, redraw);
    };
  }
  function keepFocus(root, redraw) {
    const active = document.activeElement;
    const key = active instanceof HTMLElement && root.contains(active) ? active.dataset.focus : void 0;
    redraw();
    if (key) {
      const again = [...root.querySelectorAll("[data-focus]")].find((n) => n.dataset.focus === key);
      again?.focus({ preventScroll: true });
    }
  }

  // src/ui/widgets.ts
  var CHART_FALLBACK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
  function registryColour(index) {
    const i = Math.max(0, Math.min(index, 7));
    return `var(--chart-${i + 1}, ${CHART_FALLBACK[i]})`;
  }
  function registryTile(colour, className = "") {
    const tile = el("span", "rtile" + (className ? " " + className : ""));
    tile.style.setProperty("--tone", registryColour(colour));
    tile.appendChild(icon("registry"));
    return tile;
  }
  function swatch(colour) {
    const node = el("i", "swatch");
    node.style.background = registryColour(colour);
    return node;
  }
  var RISK_ICON = { pinned: "lock", tagged: "tag", floating: "moving", latest: "moving", implicit: "alert" };
  function tagPill(entry) {
    const { ref, risk } = entry;
    const floating = risk === "latest" || risk === "implicit" || risk === "floating";
    const node = el("span", "tagpill " + (risk === "pinned" ? "pinned" : floating ? "floating" : "tagged"));
    node.appendChild(icon(RISK_ICON[risk]));
    let text;
    if (!ref.valid) text = ref.raw.trim() || "(empty)";
    else if (risk === "implicit") text = "latest (untagged)";
    else if (ref.tag && ref.digest) text = `${ref.tag} @ ${shortDigest(ref.digest)}`;
    else if (ref.digest) text = "@" + shortDigest(ref.digest);
    else text = ref.tag;
    node.appendChild(el("span", "", text));
    node.title = risk === "pinned" ? `Pinned by digest ${ref.digest}: the same bytes on every node.` : risk === "tagged" ? "A tag, not a digest: a push to the same tag changes what the next pod runs." : "A floating tag: which build runs depends on when each node pulled it.";
    return node;
  }
  var ISSUE_ICON = {
    invalid: "failed",
    pull: "failed",
    "not-ready": "alert",
    drift: "digest",
    implicit: "moving",
    latest: "moving",
    floating: "moving",
    frozen: "snowflake",
    unpinned: "unlock",
    idle: "clock"
  };
  function issueChip(issue) {
    const tone = issue.tone === "ok" ? "ok" : issue.tone;
    return chip(issue.label, tone, ISSUE_ICON[issue.kind], issue.text);
  }
  function issueChips(entry, opts = {}) {
    return entry.issues.filter((i) => (i.kind !== "unpinned" || opts.unpinned) && (i.kind !== "idle" || opts.idle !== false) && (opts.tag !== false || !TAG_KINDS.has(i.kind))).map(issueChip);
  }
  var TAG_KINDS = /* @__PURE__ */ new Set(["latest", "implicit", "floating"]);
  function diagnosisBox(issue) {
    const d = issue.diagnosis;
    if (!d) return null;
    const box = el("div", "why error");
    box.appendChild(icon("alert"));
    const body = el("div", "why-body");
    add(body, el("div", "why-head", d.title), el("div", "why-hint", d.hint));
    if (d.evidence) {
      const raw = el("code", "why-raw", d.evidence);
      raw.title = "As the node reported it";
      body.appendChild(raw);
    }
    box.appendChild(body);
    return box;
  }
  function workloadButton(w, open, opts = {}) {
    const node = button("", "wl", kindIcon(w.kind), () => open(w));
    node.dataset.focus = "wl:" + w.key;
    add(node, el("span", "wl-name", w.name), opts.namespace !== false ? el("span", "wl-ns", w.namespace) : null, opts.detail ? el("span", "wl-detail", opts.detail) : null);
    node.title = `Open ${w.kind} ${w.namespace ? w.namespace + "/" : ""}${w.name}` + (w.appKind ? "" : " (the app has no tab for this kind; opens its first pod)");
    return node;
  }
  function readiness(ready, total, pulling = 0) {
    const node = el("span", "meter");
    const bar = el("span", "meter-bar");
    const tone = pulling ? "error" : ready < total ? "warn" : "ok";
    const fill = el("i", "meter-fill " + tone);
    fill.style.width = total ? `${Math.round(ready / total * 100)}%` : "0%";
    bar.appendChild(fill);
    add(node, bar, el("span", "meter-text", total ? `${ready}/${total} ready` : "none running"));
    node.title = total ? `${plural(ready, "container")} of ${total} running this image ${ready === 1 ? "is" : "are"} ready` : "Nothing runs this image right now";
    return node;
  }
  function podState(p) {
    if (p.finished) return { text: p.phase === "Succeeded" ? "Completed" : "Failed", tone: p.phase === "Succeeded" ? "muted" : "error" };
    if (p.pullError) return { text: p.reason, tone: "error" };
    if (p.ready) return { text: p.init ? "Done" : "Ready", tone: "ok" };
    if (p.state === "waiting") return { text: p.reason || "Waiting", tone: p.reason === "ContainerCreating" || p.reason === "PodInitializing" ? "info" : "warn" };
    if (p.state === "running") return { text: "Not ready", tone: "warn" };
    if (p.state === "terminated") return { text: p.reason || "Terminated", tone: "warn" };
    return { text: "Pending", tone: "info" };
  }

  // src/pages/images.ts
  var NAMESPACES_EVERY = 3e4;
  var PODS_SHOWN = 12;
  var SHOWS = [
    { id: "all", label: "All images", icon: "grid", test: () => true },
    { id: "attention", label: "Needs attention", icon: "alert", test: (i) => i.tone === "error" || i.tone === "warn" },
    { id: "pull", label: "Failing to pull", icon: "failed", test: (i) => i.issues.some((x) => x.kind === "pull" || x.kind === "invalid") },
    { id: "floating", label: "Floating tags", icon: "moving", test: (i) => i.risk === "latest" || i.risk === "implicit" || i.risk === "floating" },
    { id: "unpinned", label: "Tagged, not pinned", icon: "unlock", test: (i) => i.risk === "tagged" },
    { id: "pinned", label: "Pinned by digest", icon: "lock", test: (i) => i.risk === "pinned" },
    { id: "idle", label: "Not running", icon: "clock", test: (i) => !i.running }
  ];
  var hash = readHash();
  var state = {
    ctx: null,
    feed: null,
    inventory: null,
    sig: "",
    namespaces: [],
    query: hash.q ?? "",
    show: SHOWS.some((s) => s.id === hash.show) ? hash.show : "all",
    registry: hash.reg ?? "",
    namespace: hash.ns ?? "",
    open: new Set((hash.open ?? "").split("|").filter(Boolean)),
    allPods: /* @__PURE__ */ new Set()
  };
  function remember() {
    writeHash({ q: state.query, show: state.show !== "all" && state.show, reg: state.registry, ns: state.namespace, open: [...state.open].join("|") });
  }
  function fail(err) {
    banner.show(err);
  }
  function openWorkload(w, usage) {
    if (w.appKind) {
      sdk.open({ kind: w.appKind, namespace: w.namespace, name: w.name }).catch(fail);
      return;
    }
    const pod = usage?.pods[0];
    if (pod) openPod(pod);
  }
  function openPod(p) {
    sdk.open({ kind: "pods", namespace: p.namespace, name: p.pod }).catch(fail);
  }
  function inNamespace(entry) {
    return !state.namespace || entry.namespaces.includes(state.namespace);
  }
  function matchesQuery(entry) {
    const q = state.query.trim().toLowerCase();
    if (!q) return true;
    const hay = [entry.key, familiar(entry.ref), registryInfo(entry.ref.registry).label, ...entry.spellings, ...entry.namespaces, ...entry.digests];
    for (const u of entry.usages) {
      hay.push(u.workload.name, u.container);
      for (const p of u.pods) hay.push(p.pod, p.node);
    }
    return q.split(/\s+/).every((word) => hay.some((h) => h.toLowerCase().includes(word)));
  }
  function scoped(inv) {
    return inv.images.filter((i) => inNamespace(i) && matchesQuery(i));
  }
  function visible(inv) {
    const test = SHOWS.find((s) => s.id === state.show)?.test ?? (() => true);
    return scoped(inv).filter((i) => test(i) && (!state.registry || i.ref.registry === state.registry));
  }
  function drawFilters(inv) {
    const nav = byId("filters");
    clear(nav);
    const inScope = scoped(inv);
    const statusTest = SHOWS.find((s) => s.id === state.show)?.test ?? (() => true);
    const byRegistry = inScope.filter((i) => !state.registry || i.ref.registry === state.registry);
    const byStatus = inScope.filter(statusTest);
    const shows = el("div", "filter-group");
    shows.appendChild(el("div", "mini-title", "Show"));
    for (const s of SHOWS) {
      const n = byRegistry.filter(s.test).length;
      if (n === 0 && s.id !== "all" && s.id !== state.show) continue;
      const b = button("", "filter" + (state.show === s.id ? " on" : "") + (s.id === "attention" && n ? " warn" : "") + (s.id === "pull" && n ? " error" : ""), s.icon, () => {
        state.show = s.id;
        remember();
        redrawAll();
      });
      b.dataset.focus = "show:" + s.id;
      b.setAttribute("aria-pressed", String(state.show === s.id));
      add(b, el("span", "filter-label", s.label), el("span", "filter-count", String(n)));
      shows.appendChild(b);
    }
    nav.appendChild(shows);
    const regs = el("div", "filter-group");
    regs.appendChild(el("div", "mini-title", "Registries"));
    const all = button("", "filter" + (state.registry ? "" : " on"), "registry", () => {
      state.registry = "";
      remember();
      redrawAll();
    });
    all.dataset.focus = "reg:";
    add(all, el("span", "filter-label", "Every registry"), el("span", "filter-count", String(byStatus.length)));
    regs.appendChild(all);
    for (const g of inv.registries) {
      const n = byStatus.filter((i) => i.ref.registry === g.registry).length;
      if (!n && state.registry !== g.registry) continue;
      const b = button("", "filter reg" + (state.registry === g.registry ? " on" : ""), null, () => {
        state.registry = state.registry === g.registry ? "" : g.registry;
        remember();
        redrawAll();
      });
      b.dataset.focus = "reg:" + g.registry;
      b.title = g.registry;
      b.setAttribute("aria-pressed", String(state.registry === g.registry));
      add(b, swatch(g.colour), el("span", "filter-label", g.label), el("span", "filter-count", String(n)));
      regs.appendChild(b);
    }
    nav.appendChild(regs);
  }
  function usageLine(entry) {
    const line = el("div", "tag-used");
    const byWorkload = /* @__PURE__ */ new Map();
    for (const u of entry.usages) {
      if (state.namespace && u.workload.namespace !== state.namespace) continue;
      const have = byWorkload.get(u.workload.key);
      const running = u.pods.filter((p) => !p.finished).length;
      if (have) have.running += running;
      else byWorkload.set(u.workload.key, { usage: u, running });
    }
    const list = [...byWorkload.values()];
    for (const { usage, running } of list.slice(0, 3)) {
      line.appendChild(workloadButton(usage.workload, (w) => openWorkload(w, usage), { detail: running ? `×${running}` : usage.declared ? "idle" : "" }));
    }
    if (list.length > 3) line.appendChild(el("span", "faint small", `+${list.length - 3} more`));
    return line;
  }
  function digestFact(entry) {
    const only = entry.digests.length === 1 ? entry.digests[0] : void 0;
    if (entry.ref.digest || !only) return null;
    const node = el("span", "digest-fact");
    add(node, icon("digest"), el("code", "", shortDigest(only)));
    node.title = `The nodes pulled ${only} for this tag. Write it after the tag to pin it.`;
    return node;
  }
  function tagRow(entry) {
    const isOpen = state.open.has(entry.key);
    const row = el("article", "tag-row " + entry.tone + (isOpen ? " open" : ""));
    const head = el("div", "tag-head");
    const toggle = iconButton(isOpen ? "chevron-down" : "chevron", isOpen ? "Hide the pods" : "Show the pods", () => {
      if (state.open.has(entry.key)) state.open.delete(entry.key);
      else state.open.add(entry.key);
      remember();
      drawList();
    }, "tag-toggle");
    toggle.dataset.focus = "toggle:" + entry.key;
    toggle.setAttribute("aria-expanded", String(isOpen));
    const chips = el("span", "tag-chips");
    add(chips, ...issueChips(entry, { tag: false }));
    const right = el("span", "tag-right");
    add(right, usageLine(entry), readiness(entry.ready, entry.containers, entry.pulling));
    add(head, toggle, tagPill(entry), digestFact(entry), chips, right);
    row.appendChild(head);
    if (isOpen) row.appendChild(detail(entry));
    return row;
  }
  function fact(label, ...value) {
    const node = el("div", "fact");
    add(node, el("span", "fact-label", label), add(el("span", "fact-value"), ...value));
    return node;
  }
  function detail(entry) {
    const box = el("div", "tag-detail");
    const issues = entry.issues.filter((i) => i.kind !== "idle" || !entry.running);
    if (issues.length) {
      const list = el("ul", "issue-list");
      for (const issue of issues) {
        const li = el("li", "issue " + issue.tone);
        add(li, issueChip(issue), el("span", "issue-text", issue.text));
        list.appendChild(li);
        const why = diagnosisBox(issue);
        if (why) list.appendChild(add(el("li", "issue-why"), why));
      }
      box.appendChild(list);
    }
    const facts = el("div", "facts");
    const canonical2 = el("code", "copyable", entry.key);
    canonical2.title = "Select to copy";
    facts.appendChild(fact("Reference", canonical2));
    if (entry.spellings.length > 1 || entry.spellings[0] !== entry.key) {
      facts.appendChild(fact("Written as", ...entry.spellings.map((s) => el("code", "name-chip", s))));
    }
    const info = registryInfo(entry.ref.registry);
    facts.appendChild(fact("Registry", el("span", "", info.label === entry.ref.registry ? entry.ref.registry : `${info.label} · ${entry.ref.registry}`), entry.ref.implicitRegistry ? el("span", "faint", " (assumed: no registry is written)") : null));
    if (entry.digests.length) {
      facts.appendChild(
        fact(
          entry.ref.digest ? "Pinned to" : entry.digests.length > 1 ? "Running builds" : "Running build",
          ...(entry.ref.digest ? [entry.ref.digest] : entry.digests).map((d) => el("code", "name-chip digest", d))
        )
      );
    }
    box.appendChild(facts);
    const table = el("div", "uses");
    for (const u of entry.usages) {
      if (state.namespace && u.workload.namespace !== state.namespace) continue;
      table.appendChild(usageBlock(entry, u));
    }
    box.appendChild(table);
    return box;
  }
  function usageBlock(entry, u) {
    const block = el("section", "use");
    const head = el("div", "use-head");
    const who = workloadButton(u.workload, (w) => openWorkload(w, u));
    const container = el("span", "use-container");
    add(container, icon(u.init ? "init" : "container"), el("span", "", u.container), u.init ? el("span", "badge", "init") : null);
    container.title = u.init ? "An init container: it runs to completion before the others start" : "Container";
    add(head, who, container);
    if (u.pullPolicy) head.appendChild(el("span", "use-policy", "pull " + u.pullPolicy));
    if (!u.declared && u.workload.kind !== "Pod") {
      head.appendChild(chip("old version", "info", "clock", `${u.workload.kind} ${u.workload.name} no longer names this image; these pods are from before its last change`));
    }
    head.appendChild(el("span", "push"));
    if (u.workload.appKind && u.workload.kind !== "Pod") {
      const yaml = iconButton(
        "edit",
        `Edit ${u.workload.kind} ${u.workload.name} as YAML`,
        () => sdk.edit({ kind: u.workload.appKind, namespace: u.workload.namespace, name: u.workload.name }).catch(fail)
      );
      yaml.dataset.focus = "yaml:" + entry.key + u.workload.key + u.container;
      head.appendChild(yaml);
    }
    block.appendChild(head);
    if (!u.pods.length) {
      block.appendChild(el("p", "quiet small", u.workload.kind === "CronJob" ? "No job is running it right now." : "No pod is running it right now."));
      return block;
    }
    const key = entry.key + "|" + u.workload.key + "|" + u.container;
    const pods = state.allPods.has(key) ? u.pods : u.pods.slice(0, PODS_SHOWN);
    const list = el("ul", "pods");
    for (const p of pods) list.appendChild(podRow(p, entry));
    block.appendChild(list);
    if (u.pods.length > PODS_SHOWN) {
      const more = button(state.allPods.has(key) ? "Show fewer" : `Show all ${u.pods.length} pods`, "ghost small", "chevron-down", () => {
        if (state.allPods.has(key)) state.allPods.delete(key);
        else state.allPods.add(key);
        drawList();
      });
      more.dataset.focus = "more:" + key;
      block.appendChild(more);
    }
    return block;
  }
  function podRow(p, entry) {
    const li = el("li", "pod-row");
    const s = podState(p);
    const name = linkButton(p.pod, () => openPod(p), `Open pod ${p.namespace}/${p.pod}`);
    name.dataset.focus = "pod:" + entry.key + p.pod + p.container;
    const where = el("span", "pod-node");
    if (p.node) add(where, icon("node"), el("span", "", p.node));
    else where.appendChild(el("span", "faint", "not scheduled"));
    const digest = el("code", "pod-digest", p.digest ? shortDigest(p.digest) : "—");
    digest.title = p.digest ? `This container runs ${p.digest}` : "No image pulled yet";
    if (p.digest && entry.digests.length > 1 && p.digest !== entry.digests[0]) digest.classList.add("odd");
    const logs = iconButton("logs", `Logs of ${p.pod}`, () => sdk.logs({ kind: "pods", namespace: p.namespace, name: p.pod }).catch(fail));
    logs.dataset.focus = "logs:" + entry.key + p.pod + p.container;
    add(
      li,
      el("i", "sdot " + s.tone),
      name,
      el("span", "pod-state " + s.tone, s.text),
      p.restarts ? el("span", "pod-restarts", `${plural(p.restarts, "restart")}`) : null,
      where,
      digest,
      logs
    );
    if (p.pullError || !p.ready && p.message && !p.finished) {
      li.title = p.message || p.eventMessage;
    }
    return li;
  }
  function registrySection(g, images) {
    const section = el("section", "reg-group");
    const head = el("header", "reg-head");
    const names = el("div", "reg-head-names");
    const title = el("h2", "", g.label);
    add(names, title, g.label !== g.registry ? el("code", "reg-head-host", g.registry) : null);
    const containers = images.reduce((n, i) => n + i.containers, 0);
    add(
      head,
      registryTile(g.colour),
      names,
      g.frozen ? chip("frozen", "warn", "snowflake", `${g.registry} gets no new images since April 2023; the same images are on registry.k8s.io`) : null,
      g.local ? chip("local", "muted", "node") : null,
      el("span", "push"),
      el("span", "reg-head-count", `${plural(images.length, "image")} · ${plural(containers, "container")}`)
    );
    section.appendChild(head);
    const byRepo = /* @__PURE__ */ new Map();
    for (const repo of g.repositories) {
      const list = repo.images.filter((i) => images.includes(i));
      if (list.length) byRepo.set(repo.key, list);
    }
    for (const [key, list] of byRepo) {
      const repo = el("div", "repo");
      const rhead = el("div", "repo-head");
      const first = list[0];
      const name = el("code", "repo-name", first.ref.valid ? familiarRepository(first.ref) : first.ref.raw.trim());
      name.title = key;
      add(rhead, icon("repo"), name, el("span", "push"), el("span", "repo-count", `${plural(list.length, "tag")} · ${plural(list.reduce((n, i) => n + i.containers, 0), "container")}`));
      repo.appendChild(rhead);
      for (const entry of list) repo.appendChild(tagRow(entry));
      section.appendChild(repo);
    }
    return section;
  }
  function drawList() {
    const inv = state.inventory;
    const list = byId("list");
    clear(list);
    if (!inv) return;
    const shown = visible(inv);
    if (!shown.length) {
      const none = el("div", "none");
      add(none, icon("search"), el("p", "", "No image matches" + (state.query ? ` “${state.query}”` : "") + (state.namespace ? ` in ${state.namespace}` : "") + "."));
      none.appendChild(
        button("Clear filters", "ghost small", "close", () => {
          state.query = "";
          state.show = "all";
          state.registry = "";
          state.namespace = "";
          byId("query").value = "";
          byId("namespace").value = "";
          remember();
          redrawAll();
        })
      );
      list.appendChild(none);
      return;
    }
    for (const g of inv.registries) {
      const images = shown.filter((i) => i.ref.registry === g.registry);
      if (images.length) list.appendChild(registrySection(g, images));
    }
  }
  function drawWhere() {
    const inv = state.inventory;
    const parts = [state.ctx?.contextName ?? ""];
    if (inv) parts.push(plural(inv.totals.images, "image"), plural(inv.totals.registries, "registry", "registries"));
    if (inv && inv.totals.attention) parts.push(`${inv.totals.attention} need${inv.totals.attention === 1 ? "s" : ""} attention`);
    byId("where").textContent = parts.filter(Boolean).join(" · ");
  }
  function drawNamespaces() {
    const select = byId("namespace");
    if (document.activeElement === select) return;
    const inv = state.inventory;
    const counts = /* @__PURE__ */ new Map();
    for (const i of inv?.images ?? []) for (const ns of i.namespaces) counts.set(ns, (counts.get(ns) ?? 0) + 1);
    const names = [.../* @__PURE__ */ new Set([...state.namespaces, ...counts.keys(), ...state.namespace ? [state.namespace] : []])].sort();
    const want = ["", ...names].map((ns) => `${ns}:${counts.get(ns) ?? ""}`).join("|");
    if (select.dataset.options === want) return;
    select.dataset.options = want;
    clear(select);
    const anywhere = el("option", "", `Every namespace (${inv?.totals.images ?? 0})`);
    anywhere.value = "";
    select.appendChild(anywhere);
    for (const ns of names) {
      const option = el("option", "", `${ns} (${counts.get(ns) ?? 0})`);
      option.value = ns;
      select.appendChild(option);
    }
    select.value = state.namespace;
  }
  function redrawAll() {
    const inv = state.inventory;
    const empty = byId("empty");
    const body = byId("body");
    drawWhere();
    if (!inv) return;
    drawNamespaces();
    if (!inv.images.length) {
      body.hidden = true;
      empty.hidden = false;
      clear(empty);
      const art = el("div", "empty-art");
      art.appendChild(icon("logo"));
      add(empty, art, el("h2", "", "No images yet"), el("p", "faint", "No pod or workload in this cluster names a container image. Deploy something and it shows up here within a few seconds."));
      return;
    }
    empty.hidden = true;
    body.hidden = false;
    drawFilters(inv);
    drawList();
  }
  byId("logo").appendChild(icon("logo"));
  byId("search-icon").appendChild(icon("search"));
  var query = byId("query");
  query.value = state.query;
  query.addEventListener("input", () => {
    state.query = query.value;
    remember();
    if (state.inventory) {
      drawFilters(state.inventory);
      drawList();
    }
  });
  query.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && query.value) {
      query.value = "";
      query.dispatchEvent(new Event("input"));
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement === document.body) {
      event.preventDefault();
      query.focus();
    }
  });
  var nsSelect = byId("namespace");
  nsSelect.addEventListener("change", () => {
    state.namespace = nsSelect.value;
    remember();
    redrawAll();
    nsSelect.blur();
  });
  var redrawList = politely(byId("list"), () => {
    if (state.inventory) drawFilters(state.inventory);
    drawList();
  });
  function onFeed(feed) {
    state.feed = feed;
    if (feed.errors.pods) banner.show(feed.errors.pods);
    else banner.clear();
    if (!feed.ready) return;
    const inv = buildInventory(feed.data);
    if (inv.signature === state.sig) return;
    const first = !state.inventory;
    state.inventory = inv;
    state.sig = inv.signature;
    drawWhere();
    drawNamespaces();
    if (first || !inv.images.length || byId("body").hidden) redrawAll();
    else redrawList();
  }
  sdk.ready().then((ctx) => {
    state.ctx = ctx;
    drawWhere();
    startFeed(sdk, { onChange: onFeed });
    every(NAMESPACES_EVERY, async () => {
      state.namespaces = await sdk.namespaces();
      if (state.inventory) drawNamespaces();
    });
  }).catch(fail);
})();
