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
      const hash = pod.metadata.labels?.["pod-template-hash"];
      if (!replicaSetOwners.has(key) && hash && owner.name.endsWith("-" + hash)) {
        return workloadRef("Deployment", ns, owner.name.slice(0, -hash.length - 1));
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
  function linkButton(text, onClick, title) {
    const node = el("button", "link", text);
    node.type = "button";
    if (title) node.title = title;
    node.addEventListener("click", onClick);
    return node;
  }

  // src/ui/charts.ts
  function ring(slices, centre, opts = {}) {
    const size = opts.size ?? 184;
    const thickness = opts.thickness ?? 20;
    const r = (size - thickness) / 2;
    const c = 2 * Math.PI * r;
    const mid = size / 2;
    const wrap = el("div", "ring");
    wrap.style.width = wrap.style.height = size + "px";
    const drawing = svg("svg", { viewBox: `0 0 ${size} ${size}`, class: "ring-svg", role: "img" });
    if (opts.label) drawing.setAttribute("aria-label", opts.label);
    drawing.appendChild(svg("circle", { cx: mid, cy: mid, r, class: "ring-track", "stroke-width": thickness }));
    const total = slices.reduce((n, s) => n + s.value, 0);
    const gap = slices.length > 1 ? Math.min(3, c / slices.length / 4) : 0;
    let offset = 0;
    for (const s of slices) {
      if (!total || s.value <= 0) continue;
      const length = s.value / total * c;
      const arc = svg("circle", {
        cx: mid,
        cy: mid,
        r,
        class: "ring-arc",
        "stroke-width": thickness,
        "stroke-dasharray": `${Math.max(0.8, length - gap)} ${c}`,
        "stroke-dashoffset": String(-offset),
        transform: `rotate(-90 ${mid} ${mid})`
      });
      arc.style.stroke = s.colour;
      const title = svg("title");
      title.textContent = s.title;
      arc.appendChild(title);
      drawing.appendChild(arc);
      offset += length;
    }
    const inner = el("div", "ring-centre");
    inner.appendChild(centre);
    add(wrap, drawing, inner);
    return wrap;
  }
  function formatValue(v, unit) {
    if (!Number.isFinite(v)) return "—";
    const round = (n) => Math.abs(n) >= 100 ? String(Math.round(n)) : Math.abs(n) >= 10 ? n.toFixed(1).replace(/\.0$/, "") : n.toFixed(2).replace(/\.?0+$/, "") || "0";
    const bytes = (n) => {
      const units = ["B", "KiB", "MiB", "GiB", "TiB"];
      let i = 0;
      while (Math.abs(n) >= 1024 && i < units.length - 1) {
        n /= 1024;
        i++;
      }
      return `${round(n)} ${units[i]}`;
    };
    switch (unit) {
      case "count":
        return String(Math.round(v));
      case "percent":
        return `${round(v * 100)}%`;
      case "ops/s":
        return `${round(v)}/s`;
      case "cores":
        return `${round(v)} cores`;
      case "bytes":
        return bytes(v);
      case "bytes/s":
        return `${bytes(v)}/s`;
      case "seconds":
        return v < 120 ? `${round(v)}s` : v < 7200 ? `${round(v / 60)}m` : `${round(v / 3600)}h`;
      default:
        return round(v);
    }
  }
  function tokenColour(c) {
    return getComputedStyle(document.documentElement).getPropertyValue(c.token).trim() || c.fallback;
  }
  var gradients = 0;
  function lineChart(chart, colourOf) {
    const card = el("article", "chart");
    const head = el("div", "chart-head");
    head.appendChild(el("h3", "", chart.label));
    card.appendChild(head);
    if (chart.description) card.appendChild(el("p", "chart-desc", chart.description));
    const series = chart.series.filter((s) => s.points.length > 0);
    if (chart.error || !series.length) {
      card.appendChild(el("p", "quiet", chart.error ? chart.error : "No data in this window."));
      return card;
    }
    let minT = Infinity;
    let maxT = -Infinity;
    let maxV = 0;
    for (const s of series) {
      for (const p of s.points) {
        minT = Math.min(minT, p.t);
        maxT = Math.max(maxT, p.t);
        if (Number.isFinite(p.v)) maxV = Math.max(maxV, p.v);
      }
    }
    if (maxT === minT) maxT = minT + 1;
    const top = maxV > 0 ? maxV * 1.15 : 1;
    const W = 600;
    const H = 120;
    const x = (t) => (t - minT) / (maxT - minT) * W;
    const y = (v) => H - Math.max(0, v) / top * H;
    const step = (maxT - minT) / 60;
    const plot = el("div", "chart-plot");
    const drawing = svg("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", class: "chart-svg", role: "img" });
    drawing.setAttribute("aria-label", `${chart.label}: ${series.map((s) => `${s.name || chart.label} ${formatValue(s.points[s.points.length - 1].v, chart.unit)}`).join(", ")}`);
    const defs = svg("defs");
    drawing.appendChild(defs);
    for (const f of [0.25, 0.5, 0.75, 1]) {
      const gy = H * (1 - f / 1.15);
      drawing.appendChild(svg("line", { x1: 0, x2: W, y1: gy, y2: gy, class: "chart-grid" }));
    }
    const legend = el("div", "chart-legend");
    series.forEach((s, i) => {
      const colour = tokenColour(colourOf(s.name, i));
      const id = `fill-${++gradients}`;
      const gradient = svg("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 });
      gradient.appendChild(svg("stop", { offset: "0%", "stop-color": colour, "stop-opacity": 0.32 }));
      gradient.appendChild(svg("stop", { offset: "100%", "stop-color": colour, "stop-opacity": 0 }));
      defs.appendChild(gradient);
      const runs = [];
      let run = [];
      s.points.forEach((p, j) => {
        const prev = s.points[j - 1];
        if (!Number.isFinite(p.v) || prev && p.t - prev.t > step * 3) {
          if (run.length) runs.push(run);
          run = [];
          if (!Number.isFinite(p.v)) return;
        }
        run.push(p);
      });
      if (run.length) runs.push(run);
      for (const r of runs) {
        const d = r.map((p, j) => `${j ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
        const first = r[0];
        const last = r[r.length - 1];
        drawing.appendChild(svg("path", { d: `${d} L${x(last.t).toFixed(1)} ${H} L${x(first.t).toFixed(1)} ${H} Z`, fill: `url(#${id})`, class: "chart-area" }));
        drawing.appendChild(svg("path", { d, stroke: colour, class: "chart-line" }));
      }
      const latest = s.points[s.points.length - 1];
      const key = el("span", "chart-key");
      const dot = el("i", "dot");
      dot.style.background = colour;
      add(key, dot, el("span", "", s.name || chart.label), el("strong", "", formatValue(latest.v, chart.unit)));
      legend.appendChild(key);
    });
    add(plot, drawing, el("span", "chart-top", formatValue(maxV, chart.unit)));
    add(card, plot, legend);
    return card;
  }

  // src/ui/format.ts
  function plural(n, one, many = one + "s") {
    return `${n} ${n === 1 ? one : many}`;
  }
  function percent(part, whole) {
    if (!whole) return "0%";
    const p = part / whole * 100;
    return (p > 0 && p < 1 ? "<1" : String(Math.round(p))) + "%";
  }
  function words(list) {
    if (list.length <= 1) return list[0] ?? "";
    return list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
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
  function politely(root, redraw2) {
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
        keepFocus(root, redraw2);
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
      else keepFocus(root, redraw2);
    };
  }
  function keepFocus(root, redraw2) {
    const active = document.activeElement;
    const key = active instanceof HTMLElement && root.contains(active) ? active.dataset.focus : void 0;
    redraw2();
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
  function swatch(colour) {
    const node = el("i", "swatch");
    node.style.background = registryColour(colour);
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
  function workloadButton(w, open2, opts = {}) {
    const node = button("", "wl", kindIcon(w.kind), () => open2(w));
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
  function imageName(entry, className = "iname") {
    const node = el("span", className);
    const ref = entry.ref;
    if (!ref.valid) {
      node.appendChild(el("span", "iname-repo", ref.raw.trim()));
      return node;
    }
    const full = familiar(ref, { shortDigest: true });
    const repoText = familiar({ ...ref, tag: "", digest: "" });
    add(node, el("span", "iname-repo", repoText), el("span", "iname-tag", full.slice(repoText.length) || ":latest"));
    node.title = entry.key;
    return node;
  }

  // src/pages/overview.ts
  var SUMMARY_EVERY = 3e4;
  var CHARTS_EVERY = 6e4;
  var HISTORY_MINUTES = 24 * 60;
  var ATTENTION_ROWS = 8;
  var RING_SLICES = 7;
  var DOCS = "https://kubernetes.io/docs/concepts/containers/images/";
  var state = { ctx: null, feed: null, inventory: null, summary: null, panel: null, sig: "", allAttention: false };
  function fail(err) {
    banner.show(err);
  }
  function open(w, entry) {
    if (w.appKind) {
      sdk.open({ kind: w.appKind, namespace: w.namespace, name: w.name }).catch(fail);
      return;
    }
    const pod = entry?.usages.find((u) => u.workload.key === w.key)?.pods[0];
    if (pod) sdk.open({ kind: "pods", namespace: pod.namespace, name: pod.pod }).catch(fail);
  }
  function openImages() {
    sdk.openView("images").catch(fail);
  }
  function openUrl(url) {
    sdk.openUrl(url).catch(fail);
  }
  function strong(text, className = "") {
    return el("strong", className, String(text));
  }
  function verdict(inv) {
    const t = inv.totals;
    if (t.pullFailing) return { tone: "error", icon: "failed", status: `${plural(t.pullFailing, "image is", "images are")} failing to pull` };
    if (t.notReady || t.drift) {
      const parts = [];
      if (t.notReady) parts.push(`${plural(t.notReady, "image has", "images have")} containers not ready`);
      if (t.drift) parts.push(`${plural(t.drift, "tag runs", "tags run")} two builds`);
      return { tone: "warn", icon: "alert", status: words(parts) };
    }
    if (t.floating) return { tone: "warn", icon: "moving", status: `Everything pulls — ${plural(t.floating, "image floats", "images float")} on a moving tag` };
    return { tone: "ok", icon: "check", status: "Every image pulls, runs and is tagged" };
  }
  function headline(inv) {
    const t = inv.totals;
    return `${plural(t.images, "image")} from ${plural(t.registries, "registry", "registries")} across ${plural(t.namespaces, "namespace")}`;
  }
  function story(inv) {
    const t = inv.totals;
    const p = el("p", "ov-story");
    add(p, strong(plural(t.containers, "container")), " in ", strong(plural(t.pods, "pod")), ` run ${t.running === t.images ? "them" : `${t.running} of them`}`);
    if (t.idle) add(p, "; ", strong(t.idle), ` ${t.idle === 1 ? "is" : "are"} declared by a workload but not running right now`);
    add(p, ". ");
    const parts = [];
    if (t.pullFailing) parts.push([strong(t.pullFailing, "bad"), el("span", "", ` can’t be pulled`)]);
    if (t.notReady) parts.push([strong(t.notReady, "warnish"), el("span", "", ` ${t.notReady === 1 ? "has" : "have"} containers that are not ready`)]);
    if (t.drift) parts.push([strong(t.drift, "warnish"), el("span", "", ` ${t.drift === 1 ? "runs" : "run"} two builds of one tag`)]);
    if (t.floating) parts.push([strong(t.floating, "warnish"), el("span", "", ` float on :latest or another moving tag`)]);
    parts.forEach((part, i) => {
      if (i > 0) add(p, i === parts.length - 1 ? " and " : ", ");
      add(p, ...part);
    });
    if (parts.length) add(p, ". ");
    add(p, strong(`${t.pinned} of ${t.images}`, t.pinned ? "ok" : ""), t.pinned === 1 ? " is" : " are", " pinned by digest.");
    return p;
  }
  function registryRing(inv) {
    const side = el("div", "ov-hero-side");
    const groups = inv.registries;
    const shown = groups.slice(0, RING_SLICES);
    const rest = groups.slice(RING_SLICES);
    const slices = shown.map((g) => ({ value: g.images, colour: registryColour(g.colour), title: `${g.label}: ${plural(g.images, "image")}` }));
    if (rest.length) {
      slices.push({ value: rest.reduce((n, g) => n + g.images, 0), colour: registryColour(7), title: `${plural(rest.length, "other registry", "other registries")}` });
    }
    const centre = el("div", "ring-text");
    add(centre, el("div", "ring-big", String(inv.totals.registries)), el("div", "ring-small", inv.totals.registries === 1 ? "registry" : "registries"));
    side.appendChild(ring(slices, centre, { label: `Images by registry: ${shown.map((g) => `${g.label} ${g.images}`).join(", ")}` }));
    const legend = el("div", "reg-legend");
    legend.appendChild(el("div", "mini-title", "Where the images come from"));
    for (const g of shown) {
      const row = button("", "reg-row", null, openImages);
      row.title = `${g.registry}: ${plural(g.images, "image")}, ${plural(g.containers, "container")} — open Images`;
      const names = el("span", "reg-names");
      add(names, el("span", "reg-label", g.label), g.label !== g.registry ? el("span", "reg-host", g.registry) : null);
      const share = el("span", "reg-share");
      const fill = el("i");
      fill.style.width = percent(g.images, inv.totals.images);
      fill.style.background = registryColour(g.colour);
      share.appendChild(fill);
      add(row, swatch(g.colour), names, g.frozen ? chip("frozen", "warn", "snowflake", `${g.registry} gets no new images; move to registry.k8s.io`) : null, share, el("span", "reg-count", String(g.images)));
      legend.appendChild(row);
    }
    if (rest.length) {
      const more = button("", "reg-row more", null, openImages);
      add(more, swatch(7), el("span", "reg-names", `and ${plural(rest.length, "more registry", "more registries")}`), el("span", "reg-share"), el("span", "reg-count", String(rest.reduce((n, g) => n + g.images, 0))));
      legend.appendChild(more);
    }
    side.appendChild(legend);
    return side;
  }
  function eyebrow() {
    const node = el("div", "ov-eyebrow");
    const logo = el("span", "logo");
    logo.appendChild(icon("logo"));
    add(node, logo, el("span", "", "Image inventory"), el("span", "faint", "· " + (state.ctx?.contextName ?? "")));
    return node;
  }
  function drawHero(inv) {
    const hero = byId("hero");
    clear(hero);
    const v = verdict(inv);
    hero.className = "ov-hero " + v.tone;
    const main = el("div", "ov-hero-main");
    main.appendChild(eyebrow());
    const h1 = el("h1", "ov-verdict");
    add(h1, icon(v.icon), el("span", "", headline(inv)));
    main.appendChild(h1);
    const status = el("p", "ov-status " + v.tone);
    add(status, el("i", "sdot " + v.tone), el("span", "", v.status));
    main.appendChild(status);
    main.appendChild(story(inv));
    const cta = el("div", "ov-cta");
    add(
      cta,
      button("Browse images", "primary", "grid", openImages),
      button("Pods", "ghost", "pod", () => sdk.open({ kind: "pods" }).catch(fail)),
      button("About image references", "ghost", "book", () => openUrl(DOCS + "#image-names"))
    );
    main.appendChild(cta);
    hero.appendChild(main);
    hero.appendChild(registryRing(inv));
  }
  function tile(label, value, sub, tone, iconName, extra) {
    const node = el("div", "stat" + (tone ? " " + tone : ""));
    const top = el("div", "stat-top");
    add(top, icon(iconName), el("span", "", label));
    add(node, top, el("div", "stat-value", value), extra ?? null, el("div", "stat-sub", sub));
    return node;
  }
  function drawStats(inv) {
    const box = byId("stats");
    clear(box);
    box.hidden = false;
    const t = inv.totals;
    const pinnedMeter = el("div", "stat-meter");
    const fill = el("i");
    fill.style.width = percent(t.pinned, t.images);
    pinnedMeter.appendChild(fill);
    add(
      box,
      tile("Images", String(t.images), t.idle ? `${t.running} running · ${t.idle} declared only` : "all of them running", "", "logo"),
      tile("Containers", String(t.containers), `in ${plural(t.pods, "pod")}`, "", "container"),
      tile("Pinned by digest", percent(t.pinned, t.images), `${t.pinned} of ${plural(t.images, "image")}`, t.pinned === t.images && t.images ? "ok" : "", "lock", pinnedMeter),
      tile("Floating tags", String(t.floating), t.floating ? ":latest, untagged or moving" : "none", t.floating ? "warn" : "ok", "moving"),
      tile("Pull failures", String(t.pullFailing), t.pullFailing ? `${plural(t.pullContainers, "container")} waiting for an image` : "every image pulls", t.pullFailing ? "error" : "ok", "failed")
    );
  }
  function attentionRow(entry) {
    const row = el("article", "att " + entry.tone);
    const top = el("div", "att-top");
    const mark = el("span", "att-mark " + entry.tone);
    mark.appendChild(icon(entry.tone === "error" ? "failed" : "alert"));
    const chips = el("span", "att-chips");
    add(chips, ...issueChips(entry, { idle: false }));
    add(top, mark, imageName(entry), chips, entry.containers ? readiness(entry.ready, entry.containers, entry.pulling) : null);
    row.appendChild(top);
    const worst = entry.issues[0];
    if (worst) {
      if (worst.diagnosis) {
        row.appendChild(el("p", "att-text", worst.text));
        const box = diagnosisBox(worst);
        if (box) row.appendChild(box);
      } else {
        row.appendChild(el("p", "att-text", worst.text));
      }
    }
    const used = el("div", "att-used");
    used.appendChild(el("span", "mini-title", "Used by"));
    const workloads = [...new Map(entry.usages.map((u) => [u.workload.key, u.workload])).values()];
    for (const w of workloads.slice(0, 4)) used.appendChild(workloadButton(w, (x) => open(x, entry)));
    if (workloads.length > 4) used.appendChild(el("span", "faint small", `+${workloads.length - 4} more`));
    row.appendChild(used);
    return row;
  }
  function drawAttention(inv) {
    const box = byId("attention");
    clear(box);
    box.hidden = false;
    const list = inv.images.filter((i) => i.tone === "error" || i.tone === "warn");
    const bad = list.filter((i) => i.tone === "error").length;
    box.className = "card attention" + (bad ? " has-error" : list.length ? " has-warn" : " clear");
    const head = el("div", "card-head");
    add(head, icon(list.length ? "alert" : "check"), el("h2", "", "Needs attention"));
    if (list.length) head.appendChild(el("span", "count " + (bad ? "error" : "warn"), String(list.length)));
    head.appendChild(el("span", "card-sub", list.length ? "Images failing to pull, with containers not ready, running two builds of one tag, or floating on a tag that moves — worst first." : ""));
    box.appendChild(head);
    if (!list.length) {
      const ok = el("div", "all-clear");
      add(ok, icon("check"), el("span", "", "Nothing needs attention: every image pulls, its containers are ready, and nothing floats on :latest."));
      box.appendChild(ok);
      return;
    }
    const rows = el("div", "att-list");
    const shown = state.allAttention ? list : list.slice(0, ATTENTION_ROWS);
    for (const entry of shown) rows.appendChild(attentionRow(entry));
    box.appendChild(rows);
    if (list.length > ATTENTION_ROWS) {
      const more = button(state.allAttention ? `Show the first ${ATTENTION_ROWS}` : `Show all ${list.length}`, "ghost small", "chevron-down", () => {
        state.allAttention = !state.allAttention;
        drawAttention(inv);
      });
      more.dataset.focus = "att-more";
      box.appendChild(more);
    }
  }
  function drawTop(inv) {
    const box = byId("top");
    clear(box);
    const head = el("div", "card-head");
    add(head, icon("rank"), el("h2", "", "Most-run images"));
    const all = button("Browse all", "ghost small push", "grid", openImages);
    head.appendChild(all);
    box.appendChild(head);
    const top = inv.images.filter((i) => i.containers > 0).sort((a, b) => b.containers - a.containers || a.key.localeCompare(b.key)).slice(0, 10);
    if (!top.length) {
      box.appendChild(el("p", "quiet", "Nothing is running."));
      return;
    }
    const max = top[0].containers;
    const list = el("ol", "bars");
    for (const entry of top) {
      const li = el("li", "bar-row");
      const registry = inv.registries.find((g) => g.registry === entry.ref.registry);
      const track = el("span", "bar-track");
      const fill = el("i", "bar-fill");
      fill.style.width = `${Math.max(3, entry.containers / max * 100)}%`;
      track.appendChild(fill);
      const workloads = new Set(entry.usages.map((u) => u.workload.key)).size;
      const label = el("div", "bar-label");
      add(label, swatch(registry?.colour ?? 7), imageName(entry), el("span", "bar-note", `${plural(entry.containers, "container")} · ${plural(workloads, "workload")}`));
      add(li, label, track);
      li.title = `${entry.key}
${registry?.label ?? entry.ref.registry}`;
      list.appendChild(li);
    }
    box.appendChild(list);
  }
  function drawUsers(inv) {
    const box = byId("users");
    clear(box);
    const head = el("div", "card-head");
    add(head, icon("users"), el("h2", "", "Biggest users"), el("span", "card-sub", "Namespaces by how many different images they run."));
    box.appendChild(head);
    const top = inv.namespaces.slice(0, 7);
    if (!top.length) {
      box.appendChild(el("p", "quiet", "No namespace runs anything yet."));
      return;
    }
    const max = top[0].images;
    const list = el("ol", "users");
    for (const ns of top) {
      const li = el("li", "user-row");
      const line = el("div", "user-line");
      const name = el("span", "user-ns");
      add(name, el("i", "sdot " + (ns.tone === "ok" ? "ok" : ns.tone)), el("span", "", ns.namespace || "(cluster)"));
      const track = el("span", "bar-track");
      const fill = el("i", "bar-fill ns");
      fill.style.width = `${Math.max(3, ns.images / max * 100)}%`;
      track.appendChild(fill);
      add(line, name, track, el("span", "user-count", `${plural(ns.images, "image")} · ${plural(ns.containers, "container")}`));
      line.title = `${ns.namespace}: ${plural(ns.images, "image")}, ${plural(ns.containers, "container")}, ${plural(ns.workloads.length, "workload")}`;
      li.appendChild(line);
      const ws = el("div", "user-workloads");
      for (const w of ns.workloads.slice(0, 3)) ws.appendChild(workloadButton(w.workload, (x) => open(x, inv.images.find((i) => i.usages.some((u) => u.workload.key === x.key))), { namespace: false, detail: plural(w.images, "image") }));
      if (ns.workloads.length > 3) ws.appendChild(el("span", "faint small", `+${ns.workloads.length - 3}`));
      li.appendChild(ws);
      list.appendChild(li);
    }
    box.appendChild(list);
  }
  var SERIES = {
    pulls: { token: "--chart-1", fallback: "#3987e5" },
    failures: { token: "--error", fallback: "#f4787f" }
  };
  function seriesColour(name, index) {
    return SERIES[name] ?? { token: `--chart-${Math.min(index + 1, 8)}`, fallback: "#3987e5" };
  }
  function drawHistory() {
    const box = byId("history");
    clear(box);
    const panel = state.panel;
    box.hidden = !panel || !panel.attached || !state.inventory || !state.inventory.images.length;
    if (box.hidden || !panel) return;
    const head = el("div", "section-head");
    add(head, icon("chart"), el("h2", "", `Over the last ${Math.round(panel.range / 60) || 24} hours`));
    if (panel.source.available && panel.source.describe) head.appendChild(el("span", "card-sub", "From Prometheus at " + panel.source.describe));
    box.appendChild(head);
    if (!panel.source.available) {
      box.appendChild(
        el(
          "p",
          "quiet",
          "No Prometheus was found in this cluster, so there is no history to draw — everything above comes from the API server. " + (panel.source.error || "If yours lives somewhere the app did not look, set its address in the cluster’s settings.")
        )
      );
      return;
    }
    const row = el("div", "chart-row");
    for (const chart of panel.charts) row.appendChild(lineChart(chart, seriesColour));
    box.appendChild(row);
  }
  var READ_KINDS = {
    deployments: "Deployments",
    statefulsets: "StatefulSets",
    daemonsets: "DaemonSets",
    replicasets: "ReplicaSets",
    jobs: "Jobs",
    cronjobs: "CronJobs",
    events: "Events"
  };
  function drawFoot(opts = {}) {
    const box = byId("foot");
    clear(box);
    box.hidden = false;
    const go = el("div", "go");
    add(
      go,
      button("Images", "go-tile", "grid", openImages),
      button("Pods", "go-tile", "pod", () => sdk.open({ kind: "pods" }).catch(fail)),
      button("Deployments", "go-tile", "deployment", () => sdk.open({ kind: "deployments" }).catch(fail)),
      button("StatefulSets", "go-tile", "statefulset", () => sdk.open({ kind: "statefulsets" }).catch(fail)),
      button("DaemonSets", "go-tile", "daemonset", () => sdk.open({ kind: "daemonsets" }).catch(fail)),
      button("CronJobs", "go-tile", "cronjob", () => sdk.open({ kind: "cronjobs" }).catch(fail))
    );
    box.appendChild(go);
    const summary = state.summary;
    const podsCard = summary?.cards.find((c) => c.kind === "pods" && c.grouped);
    if (podsCard && podsCard.total) {
      const phases = el("div", "reqs");
      phases.appendChild(el("span", "reqs-label", "Pods by phase"));
      for (const b of podsCard.buckets) {
        const tone = ["ok", "warn", "error", "info"].includes(b.tone) ? b.tone : "";
        phases.appendChild(chip(`${b.value || "no status yet"} ${b.count}`, tone));
      }
      box.appendChild(phases);
    }
    if (summary && summary.requirements.length) {
      const reqs = el("div", "reqs");
      reqs.appendChild(el("span", "reqs-label", "This cluster serves"));
      for (const r of summary.requirements) {
        const tone = r.error ? "warn" : r.served ? "ok" : r.optional ? "muted" : "error";
        reqs.appendChild(chip(r.label, tone, r.error ? "alert" : r.served ? "check" : "close", r.error || r.kind));
      }
      box.appendChild(reqs);
    }
    const errors = Object.entries(state.feed?.errors ?? {}).filter(([kind]) => kind !== "pods");
    if (errors.length && opts.readErrors !== false) {
      const note = el("p", "foot-note");
      note.appendChild(icon("info"));
      add(
        note,
        el(
          "span",
          "",
          `Could not read ${words(errors.map(([kind]) => READ_KINDS[kind] ?? kind))}, so pods are grouped as far up their owners as the rest allows. ` + errors.map(([kind, msg]) => `${READ_KINDS[kind] ?? kind}: ${msg}`).join(" · ")
        )
      );
      box.appendChild(note);
    }
    const plugin = state.ctx?.plugin;
    const about = el("div", "about");
    const who = el("span", "about-name");
    add(who, icon("logo"), el("span", "", plugin?.name || "Image inventory"), plugin?.version ? el("span", "about-version", "v" + plugin.version) : null);
    about.appendChild(who);
    const links = [...plugin?.links ?? []];
    if (plugin?.docs && !links.some((l) => l.url === plugin.docs)) links.unshift({ label: "Documentation", url: plugin.docs });
    for (const l of links) {
      const b = linkButton(l.label || l.url, () => openUrl(l.url), l.url);
      b.prepend(icon("open"));
      b.classList.add("about-link");
      about.appendChild(b);
    }
    box.appendChild(about);
  }
  function drawAbsent(kind, detail) {
    const hero = byId("hero");
    clear(hero);
    hero.className = "ov-hero absent";
    for (const id of ["stats", "attention", "columns", "history"]) byId(id).hidden = true;
    const main = el("div", "ov-hero-main");
    const art = el("div", "empty-art");
    art.appendChild(icon("logo"));
    main.appendChild(art);
    const title = kind === "unreachable" ? "This cluster did not answer" : kind === "pods" ? "Pods could not be read" : `This cluster does not serve pods`;
    const text = kind === "unreachable" ? "Whether anything runs here could not be checked — which is not the same as nothing running. The page tries again on its own." : kind === "pods" ? "Every image this page shows comes from the pods’ specs and statuses, so without them there is nothing to take stock of." : "Every Kubernetes cluster serves pods, so this is an API server that is not answering the usual way.";
    add(main, el("h1", "ov-verdict", title), el("p", "ov-story", text));
    if (detail) main.appendChild(el("code", "absent-detail", detail));
    hero.appendChild(main);
    drawFoot({ readErrors: false });
  }
  function drawEmpty() {
    const hero = byId("hero");
    clear(hero);
    hero.className = "ov-hero absent";
    for (const id of ["stats", "attention", "columns", "history"]) byId(id).hidden = true;
    const main = el("div", "ov-hero-main");
    main.appendChild(eyebrow());
    const art = el("div", "empty-art");
    art.appendChild(icon("logo"));
    main.appendChild(art);
    add(
      main,
      el("h1", "ov-verdict", "No containers yet"),
      el("p", "ov-story", "There are no pods or workloads in any namespace this cluster lets you list. Deploy something and its images appear here within a few seconds — with where they come from and whether they pull.")
    );
    const cta = el("div", "ov-cta");
    cta.appendChild(button("About container images", "primary", "book", () => openUrl(DOCS)));
    main.appendChild(cta);
    hero.appendChild(main);
    drawFoot();
  }
  function render() {
    const summary = state.summary;
    const feed = state.feed;
    if (summary && !summary.checked) return drawAbsent("unreachable", summary.error);
    if (summary && !summary.installed) return drawAbsent("missing", summary.requirements.filter((r) => !r.served && !r.optional).map((r) => r.kind).join(", "));
    if (feed && !feed.ready && feed.errors.pods) return drawAbsent("pods", feed.errors.pods);
    const inv = state.inventory;
    if (!inv) return;
    if (!inv.images.length) return drawEmpty();
    byId("columns").hidden = false;
    drawHero(inv);
    drawStats(inv);
    drawAttention(inv);
    drawTop(inv);
    drawUsers(inv);
    drawHistory();
    drawFoot();
  }
  var redraw = politely(document.body, render);
  function onFeed(feed) {
    state.feed = feed;
    if (feed.ready && feed.errors.pods) banner.show(feed.errors.pods);
    else banner.clear();
    const inv = feed.ready ? buildInventory(feed.data) : null;
    const sig = (inv?.signature ?? "none") + fingerprint(JSON.stringify(feed.errors));
    if (sig === state.sig) return;
    state.inventory = inv;
    state.sig = sig;
    redraw();
  }
  sdk.ready().then((ctx) => {
    state.ctx = ctx;
    startFeed(sdk, { onChange: onFeed });
    every(SUMMARY_EVERY, async () => {
      const summary = await sdk.summary();
      const changed = JSON.stringify(summary) !== JSON.stringify(state.summary);
      state.summary = summary;
      if (changed) redraw();
    });
    every(CHARTS_EVERY, async () => {
      state.panel = await sdk.charts({ minutes: HISTORY_MINUTES });
      if (state.inventory) drawHistory();
    });
    sdk.on("theme", () => drawHistory());
  }).catch(fail);
})();
