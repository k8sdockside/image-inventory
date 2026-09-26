// Built by k8sdockside-plugin from src/ -- edit the TypeScript there, not this file.
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
  function repositoryOfImageID(imageID) {
    if (!imageID) return "";
    const at = imageID.lastIndexOf("@");
    if (at <= 0) return "";
    const ref = parseImageRef(imageID.slice(0, at).replace(/^[a-z-]+:\/\//, ""));
    return ref.valid ? repositoryKey(ref) : "";
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
      digestFrom: repositoryOfImageID(status?.imageID),
      pullError: state2 === "waiting" && isPullReason(reason),
      eventMessage: eventMessages.get(`${ns}/${pod.metadata.name}/${container.name}`) ?? ""
    };
  }
  function comparableDigest(use, ref) {
    if (ref.digest) return ref.digest;
    return use.digest && use.digestFrom === repositoryKey(ref) ? use.digest : "";
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
        b = { key, ref, spellings: /* @__PURE__ */ new Set(), podSpelling: "", usages: /* @__PURE__ */ new Map() };
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
        const use = podUse(pod, container, init, eventMessages);
        usageFor(b, workload, container, init).pods.push(use);
        if (!use.finished && !b.podSpelling) b.podSpelling = container.image.trim();
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
    const builds = new Set(running.map((p) => comparableDigest(p, ref)).filter(Boolean));
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
    if (!ref.digest && builds.size > 1) {
      const drifted = digests.filter((d) => builds.has(d));
      issues.push({
        kind: "drift",
        tone: "warn",
        label: `${drifted.length} builds`,
        text: `Pods run ${drifted.length} different builds of this tag (${drifted.map(shortDigest).join(", ")}): it was pushed again after some nodes pulled it.`
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
    const spellings = [...b.spellings].sort();
    return {
      key: b.key,
      ref,
      risk,
      spellings,
      podSpelling: b.podSpelling || spellings[0] || b.key,
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

  // src/model/versions.ts
  var VERSION = /^([vV]?)(\d{1,15}(?:\.\d{1,15}){0,3})(?:([-+_])(.+))?$/;
  var COMMIT = /^g?[0-9a-f]{7,40}$/i;
  var STAGES = { alpha: 1, beta: 2, pre: 3, preview: 3, rc: 4, cr: 4 };
  var PRERELEASE = /* @__PURE__ */ new Set([
    "prerelease",
    "dev",
    "devel",
    "develop",
    "development",
    "snapshot",
    "nightly",
    "canary",
    "next",
    "edge",
    "unstable",
    "experimental",
    "insider",
    "insiders",
    "milestone",
    "wip",
    "test",
    "testing",
    "debug"
  ]);
  var FLAVOURS = /* @__PURE__ */ new Set(["test", "testing", "debug"]);
  var SCHEME_BREAK = 1e3;
  function readSuffix(suffix) {
    const out = { shape: "", numbers: [], prerelease: false, stepsOnly: true };
    out.shape = suffix.replace(/[A-Za-z0-9]+/g, (segment) => {
      if (COMMIT.test(segment) && /\d/.test(segment) && /[a-f]/i.test(segment)) {
        out.stepsOnly = false;
        return "#";
      }
      return segment.replace(/[A-Za-z]+|\d+/g, (run) => {
        if (/^\d/.test(run)) {
          out.numbers.push(Number(run));
          return "0";
        }
        const word = run.toLowerCase();
        const stage = STAGES[word];
        if (stage !== void 0) {
          out.prerelease = true;
          out.numbers.push(stage);
          return "~";
        }
        if (PRERELEASE.has(word)) {
          out.prerelease = true;
          if (FLAVOURS.has(word)) out.stepsOnly = false;
        } else {
          out.stepsOnly = false;
        }
        return run;
      });
    });
    return out;
  }
  function parseVersion(tag) {
    const m = VERSION.exec(tag);
    if (!m) return null;
    const prefix = m[1] ?? "";
    const parts = (m[2] ?? "").split(".").map(Number);
    const suffix = m[3] ? m[3] + (m[4] ?? "") : "";
    const s = readSuffix(suffix);
    const base = `${prefix}/${parts.length}/`;
    return {
      tag,
      prefix,
      parts,
      suffix,
      numbers: s.numbers,
      shape: base + s.shape,
      releaseShape: s.prerelease && s.stepsOnly && suffix ? base : "",
      prerelease: s.prerelease
    };
  }
  function compareNumbers(a, b) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const d = (a[i] ?? 0) - (b[i] ?? 0);
      if (d) return d < 0 ? -1 : 1;
    }
    return 0;
  }
  function releaseLast(a, b) {
    if (a.prerelease && !b.prerelease && !b.suffix) return -1;
    if (b.prerelease && !a.prerelease && !a.suffix) return 1;
    return 0;
  }
  function compareVersions(a, b) {
    return compareNumbers(a.parts, b.parts) || releaseLast(a, b) || compareNumbers(a.numbers, b.numbers);
  }
  function noUpdates() {
    return { patch: null, minor: null, major: null, kind: null };
  }
  function stepOf(from, to) {
    if (to.parts[0] !== from.parts[0]) return "major";
    if (from.parts.length > 1 && to.parts[1] !== from.parts[1]) return "minor";
    return "patch";
  }
  function mayBeVersion(tag) {
    const c = tag.charCodeAt(0);
    return c >= 48 && c <= 57 || c === 118 || c === 86;
  }
  function findUpdates(tag, tags) {
    const out = noUpdates();
    const current = parseVersion(tag);
    if (!current) return out;
    const small = (current.parts[0] ?? 0) < SCHEME_BREAK;
    const best = {};
    for (const candidate of tags) {
      if (candidate === tag || !mayBeVersion(candidate)) continue;
      const v = parseVersion(candidate);
      if (!v) continue;
      if (v.prerelease && !current.prerelease) continue;
      if (v.shape !== current.shape && v.shape !== current.releaseShape) continue;
      if (small && (v.parts[0] ?? 0) >= SCHEME_BREAK) continue;
      if (compareVersions(v, current) <= 0) continue;
      const kind = stepOf(current, v);
      const have = best[kind];
      if (!have || compareVersions(v, have) > 0) best[kind] = v;
    }
    out.patch = best.patch?.tag ?? null;
    out.minor = best.minor?.tag ?? null;
    out.major = best.major?.tag ?? null;
    out.kind = out.major ? "major" : out.minor ? "minor" : out.patch ? "patch" : null;
    return out;
  }
  var PARTS_RANK = [9, 3, 1, 0, 2];
  function preferred(a, b) {
    if (a.count !== b.count) return a.count > b.count;
    const plainA = a.newest.suffix ? 1 : 0;
    const plainB = b.newest.suffix ? 1 : 0;
    if (plainA !== plainB) return plainA < plainB;
    const partsA = PARTS_RANK[a.newest.parts.length] ?? 9;
    const partsB = PARTS_RANK[b.newest.parts.length] ?? 9;
    if (partsA !== partsB) return partsA < partsB;
    return a.key < b.key;
  }
  function newestVersion(tags) {
    const shapes = /* @__PURE__ */ new Map();
    for (const tag of tags) {
      if (!mayBeVersion(tag)) continue;
      const v = parseVersion(tag);
      if (!v || v.prerelease) continue;
      const key = (v.parts[0] ?? 0) >= SCHEME_BREAK ? v.shape + "/dated" : v.shape;
      const have = shapes.get(key);
      if (!have) shapes.set(key, { key, count: 1, newest: v });
      else {
        have.count++;
        if (compareVersions(v, have.newest) > 0) have.newest = v;
      }
    }
    let pick;
    for (const s of shapes.values()) if (!pick || preferred(s, pick)) pick = s;
    return pick?.newest.tag ?? null;
  }

  // src/model/updates.ts
  var STATE_ORDER = ["major", "minor", "patch", "rebuilt", "failed", "unknown", "pending", "current"];
  var STATE_RANK = Object.fromEntries(STATE_ORDER.map((s, i) => [s, i]));
  function hasUpdate(state2) {
    return state2 === "major" || state2 === "minor" || state2 === "patch" || state2 === "rebuilt";
  }
  var TAG_LIMIT = 1e4;
  var FAILURE_LABEL = {
    auth: "needs credentials",
    limited: "rate-limited",
    missing: "not found",
    unreachable: "unreachable",
    error: "failed"
  };
  var FAILURE_GIST = {
    auth: "the registry wants credentials",
    limited: "the registry is rate-limiting",
    missing: "the registry does not know the repository",
    unreachable: "the registry could not be reached",
    error: "the registry could not be asked"
  };
  function failureText(lookup) {
    switch (lookup.status) {
      case "ok":
        return "";
      case "auth":
        return "The registry wants credentials; only public images are checked.";
      case "limited":
        return "The registry is rate-limiting; try again later.";
      case "missing":
        return "The registry does not know this repository (or this tag).";
      case "unreachable":
        return `Could not reach ${lookup.registry}` + (lookup.error ? `: ${lookup.error}` : ".");
      default:
        return lookup.error || "The registry could not be asked.";
    }
  }
  function refusedLookup(ref, image, reason, now) {
    return {
      image,
      registry: ref.registry,
      repository: ref.repository,
      tag: effectiveTag(ref),
      tags: [],
      truncated: false,
      digest: "",
      checkedAt: now,
      status: "error",
      error: reason
    };
  }
  function tagsPage(ref) {
    if (ref.registry === DOCKER_HUB) {
      const official = ref.repository.startsWith("library/");
      return {
        label: "Tags on Docker Hub",
        url: official ? `https://hub.docker.com/_/${ref.repository.slice("library/".length)}/tags` : `https://hub.docker.com/r/${ref.repository}/tags`
      };
    }
    if (ref.registry === "quay.io") return { label: "Tags on Quay", url: `https://quay.io/repository/${ref.repository}?tab=tags` };
    return null;
  }
  function workloadsOf(entry) {
    const byKey = /* @__PURE__ */ new Map();
    for (const usage of entry.usages) {
      const running = usage.pods.filter((p) => !p.finished).length;
      if (!running) continue;
      const have = byKey.get(usage.workload.key);
      if (have) have.running += running;
      else byKey.set(usage.workload.key, { workload: usage.workload, usage, running });
    }
    return [...byKey.values()].sort((a, b) => b.running - a.running || a.workload.key.localeCompare(b.workload.key));
  }
  function updateRow(entry, lookup) {
    const ref = entry.ref;
    const tag = effectiveTag(ref);
    const workloads = workloadsOf(entry);
    const row = {
      key: entry.key,
      entry,
      tag,
      ask: tag ? entry.podSpelling : "",
      versioned: !!tag && parseVersion(tag) !== null,
      lookup: tag ? lookup : null,
      state: "pending",
      updates: noUpdates(),
      newest: null,
      repushed: false,
      behind: 0,
      staleDigests: [],
      reason: "",
      note: "",
      containers: entry.containers,
      workloads,
      namespaces: [...new Set(workloads.map((w) => w.workload.namespace))].sort(),
      registryLabel: registryInfo(ref.registry).label
    };
    if (!tag) {
      row.state = "unknown";
      row.note = "Pinned by a digest alone: there is no tag to look for newer versions of.";
      return row;
    }
    if (!row.lookup) return row;
    const answer = row.lookup;
    if (answer.status !== "ok") {
      row.state = "failed";
      row.reason = failureText(answer);
      return row;
    }
    row.updates = findUpdates(tag, answer.tags);
    if (!row.versioned) row.newest = newestVersion(answer.tags);
    const builds = [];
    for (const u of entry.usages) {
      for (const p of u.pods) {
        const build = p.finished ? "" : comparableDigest(p, ref);
        if (build) builds.push(build);
      }
    }
    const compared = !!answer.digest && builds.length > 0;
    if (compared) {
      const stale = builds.filter((d) => d !== answer.digest);
      const counts = /* @__PURE__ */ new Map();
      for (const d of stale) counts.set(d, (counts.get(d) ?? 0) + 1);
      row.behind = stale.length;
      row.staleDigests = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([d]) => d);
      row.repushed = stale.length > 0;
    }
    if (row.updates.kind) row.state = row.updates.kind;
    else if (row.repushed) row.state = "rebuilt";
    else if (row.versioned || compared) row.state = "current";
    else {
      row.state = "unknown";
      row.note = !answer.digest ? `:${tag} is not a version, and the registry did not say which build it points at.` : `:${tag} is not a version, and no pod has reported which build it runs yet.`;
    }
    if (answer.truncated) {
      const cut = `Only the first ${TAG_LIMIT} tags were read, so a newer one may be missing.`;
      row.note = row.note ? `${row.note} ${cut}` : cut;
    }
    return row;
  }
  function byUrgency(a, b) {
    return STATE_RANK[a.state] - STATE_RANK[b.state] || b.containers - a.containers || a.key.localeCompare(b.key);
  }
  function summarise(rows) {
    const counts = Object.fromEntries(STATE_ORDER.map((s) => [s, 0]));
    const failures = /* @__PURE__ */ new Map();
    const workloads = /* @__PURE__ */ new Set();
    let containers = 0;
    let oldest = 0;
    for (const r of rows) {
      counts[r.state]++;
      if (hasUpdate(r.state)) {
        containers += r.containers;
        for (const w of r.workloads) workloads.add(w.workload.key);
      }
      if (r.lookup && r.lookup.status !== "ok") failures.set(r.lookup.status, (failures.get(r.lookup.status) ?? 0) + 1);
      const t = r.lookup ? Date.parse(r.lookup.checkedAt) : NaN;
      if (Number.isFinite(t) && (!oldest || t < oldest)) oldest = t;
    }
    let commonFailure = null;
    let tied = false;
    for (const [status, count2] of failures) {
      if (commonFailure && count2 === commonFailure.count) tied = true;
      if (!commonFailure || count2 > commonFailure.count) {
        commonFailure = { status, gist: FAILURE_GIST[status], count: count2 };
        tied = false;
      }
    }
    if (tied) commonFailure = null;
    return {
      images: rows.length,
      counts,
      updates: rows.filter((r) => hasUpdate(r.state)).length,
      containers,
      workloads: workloads.size,
      repushed: rows.filter((r) => r.repushed).length,
      askable: rows.filter((r) => r.ask).length,
      answered: rows.filter((r) => r.ask && r.lookup).length,
      oldestAnswer: oldest,
      commonFailure
    };
  }
  function buildUpdates(inv, lookups) {
    const rows = inv.images.filter((i) => i.running && i.ref.valid).map((i) => updateRow(i, lookups.get(i.key) ?? null));
    rows.sort(byUrgency);
    return {
      rows,
      summary: summarise(rows),
      signature: fingerprint(
        inv.signature + JSON.stringify(
          rows.map((r) => [r.key, r.state, r.updates, r.newest, r.behind, r.reason, r.note, r.lookup?.checkedAt ?? "", r.lookup?.digest ?? "", r.workloads.map((w) => [w.workload.key, w.running])])
        )
      )
    };
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
    // An arrow up out of a circle: something newer to run.
    update: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 16.5v-9", "M8.5 11 12 7.5l3.5 3.5"],
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

  // src/ui/format.ts
  function plural(n, one, many = one + "s") {
    return `${n} ${n === 1 ? one : many}`;
  }
  function ago(ms, now = Date.now()) {
    if (!ms) return "";
    const d = Math.max(0, now - ms);
    if (d < 1e4) return "just now";
    if (d < 6e4) return `${Math.round(d / 1e3)}s ago`;
    if (d < 36e5) return `${Math.round(d / 6e4)}m ago`;
    if (d < 1728e5) return `${Math.round(d / 36e5)}h ago`;
    return `${Math.round(d / 864e5)}d ago`;
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
      const again2 = [...root.querySelectorAll("[data-focus]")].find((n) => n.dataset.focus === key);
      again2?.focus({ preventScroll: true });
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
  function workloadButton(w, open, opts = {}) {
    const node = button("", "wl", kindIcon(w.kind), () => open(w));
    node.dataset.focus = "wl:" + w.key;
    add(node, el("span", "wl-name", w.name), opts.namespace !== false ? el("span", "wl-ns", w.namespace) : null, opts.detail ? el("span", "wl-detail", opts.detail) : null);
    node.title = `Open ${w.kind} ${w.namespace ? w.namespace + "/" : ""}${w.name}` + (w.appKind ? "" : " (the app has no tab for this kind; opens its first pod)");
    return node;
  }

  // src/pages/updates.ts
  var IN_FLIGHT = 4;
  var PODS_EVERY = 15e3;
  var OWNERS_EVERY = 6e4;
  var DRAW_AFTER = 150;
  var WORKLOADS_SHOWN = 3;
  var SHOWS = [
    { id: "all", label: "All", icon: "grid", test: () => true },
    { id: "updates", label: "Updates", icon: "update", test: (r) => hasUpdate(r.state) },
    { id: "major", label: "Major", icon: "update", test: (r) => r.state === "major" },
    { id: "minor", label: "Minor", icon: "update", test: (r) => r.state === "minor" },
    { id: "patch", label: "Patch", icon: "update", test: (r) => r.state === "patch" },
    { id: "rebuilt", label: "Rebuilt", icon: "digest", test: (r) => r.state === "rebuilt" },
    { id: "current", label: "Up to date", icon: "check", test: (r) => r.state === "current" },
    { id: "unknown", label: "Can’t tell", icon: "info", test: (r) => r.state === "unknown" },
    { id: "failed", label: "Couldn’t check", icon: "alert", test: (r) => r.state === "failed" }
  ];
  var LOOK = {
    major: { icon: "update", label: "A newer major version" },
    minor: { icon: "update", label: "A newer minor version" },
    patch: { icon: "update", label: "A newer patch" },
    rebuilt: { icon: "digest", label: "The tag points at a newer build" },
    current: { icon: "check", label: "Up to date" },
    unknown: { icon: "info", label: "Nothing to compare" },
    failed: { icon: "alert", label: "The registry could not be asked" },
    pending: { icon: "clock", label: "Asking the registry" }
  };
  var STEP_TONE = { major: "error", minor: "warn", patch: "info" };
  var hash = readHash();
  var state = {
    ctx: null,
    inventory: null,
    inventorySig: "",
    lookups: /* @__PURE__ */ new Map(),
    report: null,
    drawn: "",
    query: hash.q ?? "",
    show: SHOWS.some((s) => s.id === hash.show) ? hash.show : "all",
    namespace: hash.ns ?? ""
  };
  function remember() {
    writeHash({ q: state.query, show: state.show !== "all" && state.show, ns: state.namespace });
  }
  function fail(err) {
    banner.show(err);
  }
  var questions = {
    waiting: [],
    /** Keys waiting or in flight, so an image is never asked twice at once. */
    open: /* @__PURE__ */ new Set(),
    inFlight: 0,
    /** This round: how many were asked, and how many have been answered. */
    total: 0,
    done: 0
  };
  function asking() {
    return questions.inFlight > 0 || questions.waiting.length > 0;
  }
  function ask(rows, refresh) {
    if (!asking()) {
      questions.total = 0;
      questions.done = 0;
    }
    for (const r of rows) {
      if (!r.ask || questions.open.has(r.key)) continue;
      if (!refresh && state.lookups.has(r.key)) continue;
      questions.open.add(r.key);
      questions.waiting.push({ key: r.key, image: r.ask, ref: r.entry.ref, refresh });
      questions.total++;
    }
    pump();
    drawHero();
  }
  function pump() {
    const registry = sdk.registry;
    if (!registry) return;
    while (questions.inFlight < IN_FLIGHT && questions.waiting.length) {
      const q = questions.waiting.shift();
      questions.inFlight++;
      registry.lookup({ image: q.image, refresh: q.refresh }).catch((err) => refusedLookup(q.ref, q.image, message(err), (/* @__PURE__ */ new Date()).toISOString())).then((answer) => {
        state.lookups.set(q.key, answer);
      }).finally(() => {
        questions.inFlight--;
        questions.open.delete(q.key);
        questions.done++;
        rebuild();
        pump();
      });
    }
  }
  function openWorkload(w, usage) {
    if (w.appKind) {
      sdk.open({ kind: w.appKind, namespace: w.namespace, name: w.name }).catch(fail);
      return;
    }
    const pod = usage.pods.find((p) => !p.finished) ?? usage.pods[0];
    if (pod) sdk.open({ kind: "pods", namespace: pod.namespace, name: pod.pod }).catch(fail);
  }
  function inNamespace(r) {
    return !state.namespace || r.namespaces.includes(state.namespace);
  }
  function matchesQuery(r) {
    const q = state.query.trim().toLowerCase();
    if (!q) return true;
    const hay = [r.key, familiar(r.entry.ref), r.tag, r.registryLabel, ...r.entry.spellings, ...r.namespaces];
    for (const step of [r.updates.patch, r.updates.minor, r.updates.major, r.newest]) if (step) hay.push(step);
    for (const w of r.workloads) hay.push(w.workload.name);
    return q.split(/\s+/).every((word) => hay.some((h) => h.toLowerCase().includes(word)));
  }
  function scoped(report) {
    return report.rows.filter((r) => inNamespace(r) && matchesQuery(r));
  }
  function strong(text, className = "") {
    return el("strong", className, String(text));
  }
  function headline(s, busy) {
    if (s.updates) return `${s.updates} of ${plural(s.images, "image")} ${s.updates === 1 ? "has an update" : "have updates"}`;
    if (busy) return s.answered ? "No updates so far" : `Checking ${plural(s.askable, "image")}…`;
    if (!s.askable) return `${plural(s.images, "image")}, all pinned by digest`;
    if (s.counts.current === s.images) return s.images === 1 ? "The one image is up to date" : `All ${s.images} images are up to date`;
    return `No updates found for ${plural(s.images, "image")}`;
  }
  function drawVerdict(p, s) {
    clear(p);
    const c = s.counts;
    const steps = [];
    if (c.major) steps.push([strong(c.major, "bad"), " major"]);
    if (c.minor) steps.push([strong(c.minor, "warnish"), " minor"]);
    if (c.patch) steps.push([strong(c.patch), " patch"]);
    if (c.rebuilt) steps.push([strong(c.rebuilt), " rebuilt"]);
    steps.forEach((step, i) => {
      if (i > 0) add(p, i === steps.length - 1 ? " and " : ", ");
      add(p, ...step);
    });
    if (steps.length) add(p, ", in ", strong(plural(s.containers, "container")), " across ", strong(plural(s.workloads, "workload")), ". ");
    const alsoPushed = s.repushed - c.rebuilt;
    if (alsoPushed > 0) {
      add(p, strong(alsoPushed), ` with a newer version ${alsoPushed === 1 ? "was" : "were"} also pushed again since ${alsoPushed === 1 ? "its" : "their"} pods pulled ${alsoPushed === 1 ? "it" : "them"}. `);
    }
    if (c.failed) {
      const why = s.commonFailure;
      add(p, strong(c.failed, "warnish"), " couldn’t be checked");
      if (why) add(p, why.count < c.failed ? `, mostly because ${why.gist} (${why.count})` : `: ${why.gist}`);
      add(p, ". ");
    }
    if (c.unknown) {
      add(p, strong(c.unknown), ` ${c.unknown === 1 ? "has" : "have"} nothing to compare: a tag that is not a version with no build to check, or a digest with no tag. `);
    }
    if (!s.answered && s.askable) {
      add(p, "The app asks each image’s registry which tags it has — anonymously, so private images cannot be checked.");
    } else if (!steps.length && !c.failed && !c.unknown && !c.pending) {
      add(p, "Every version tag is the newest of its kind, and every other tag still points at the build its pods run.");
    }
  }
  function drawProgress(p, s, busy) {
    clear(p);
    p.hidden = false;
    if (busy) {
      add(p, el("span", "pulse"), el("span", "", `Asked the registries about ${questions.done} of ${plural(questions.total, "image")}…`));
      return;
    }
    if (!s.answered) {
      p.hidden = true;
      return;
    }
    const oldest = ago(s.oldestAnswer);
    add(p, icon("clock"), el("span", "", `Checked ${plural(s.answered, "image")}` + (oldest ? ` · oldest answer ${oldest}` : "") + " · the app keeps an answer for about half an hour"));
  }
  function drawHero() {
    const report = state.report;
    if (!report) return;
    const s = report.summary;
    const busy = asking();
    const everythingCurrent = s.images > 0 && s.counts.current === s.images;
    byId("hero").className = "ov-hero up-hero " + (s.updates ? "warn" : busy ? "busy" : everythingCurrent ? "ok" : "muted");
    const h = byId("headline");
    clear(h);
    add(h, icon(s.updates ? "update" : busy ? "clock" : everythingCurrent ? "check" : "info"), el("span", "", headline(s, busy)));
    drawVerdict(byId("verdict"), s);
    drawProgress(byId("progress"), s, busy);
    byId("again").disabled = busy || !s.askable;
  }
  function setShow(show) {
    state.show = show;
    remember();
    keepFocus(byId("body"), drawBody);
  }
  function drawFilters(report) {
    const nav = byId("filters");
    clear(nav);
    const inScope = scoped(report);
    for (const s of SHOWS) {
      const n = inScope.filter(s.test).length;
      const on = state.show === s.id;
      const b = button("", `filter ${s.id}` + (on ? " on" : "") + (n ? "" : " zero"), s.icon, () => setShow(s.id));
      b.dataset.focus = "show:" + s.id;
      b.setAttribute("aria-pressed", String(on));
      add(b, el("span", "filter-label", s.label), el("span", "filter-count", String(n)));
      nav.appendChild(b);
    }
  }
  function usedBy(r) {
    const line = el("span", "tag-used");
    const list = r.workloads.filter((w) => !state.namespace || w.workload.namespace === state.namespace);
    for (const w of list.slice(0, WORKLOADS_SHOWN)) {
      const b = workloadButton(w.workload, (x) => openWorkload(x, w.usage), { detail: `×${w.running}` });
      b.dataset.focus = "wl:" + r.key + "|" + w.workload.key;
      line.appendChild(b);
    }
    if (list.length > WORKLOADS_SHOWN) line.appendChild(el("span", "faint small", `+${list.length - WORKLOADS_SHOWN} more`));
    return line;
  }
  function registryLabel(r) {
    const node = el("span", "up-reg");
    const group = state.inventory?.registries.find((g) => g.registry === r.entry.ref.registry);
    add(node, swatch(group?.colour ?? 7), el("span", "", r.registryLabel));
    node.title = r.entry.ref.registry;
    return node;
  }
  function stateChips(r) {
    const chips = el("span", "tag-chips");
    const repo = familiarRepository(r.entry.ref);
    for (const kind of ["patch", "minor", "major"]) {
      const tag = r.updates[kind];
      if (tag) chips.appendChild(chip(`${kind} ${tag}`, STEP_TONE[kind], "update", `A newer ${kind} version: ${repo}:${tag}`));
    }
    if (r.repushed) {
      chips.appendChild(
        chip(r.state === "rebuilt" ? "rebuilt" : "pushed again", "info", "digest", `:${r.tag} now points at a build ${plural(r.behind, "container")} here ${r.behind === 1 ? "does" : "do"} not run`)
      );
    }
    if (r.newest) chips.appendChild(chip(`newest version ${r.newest}`, "muted", "tag", `The newest release in ${repo}. :${r.tag} is not a version, so it is not compared with it.`));
    const failed = r.lookup && r.lookup.status !== "ok" ? r.lookup.status : null;
    if (r.state === "current") chips.appendChild(chip("up to date", "ok", "check"));
    else if (failed) chips.appendChild(chip(FAILURE_LABEL[failed], "muted", "alert", r.reason));
    else if (r.state === "unknown") chips.appendChild(chip("can’t tell", "muted", "info", r.note));
    else if (r.state === "pending") chips.appendChild(chip("asking…", "muted", "clock"));
    return chips;
  }
  function digestCode(digest) {
    const node = el("code", "", shortDigest(digest));
    node.title = digest;
    return node;
  }
  function footOf(r) {
    const text = el("span", "up-foot-text");
    if (r.reason) text.appendChild(el("span", "up-reason", r.reason));
    if (r.repushed && r.lookup) {
      const stale = r.staleDigests.slice(0, 2);
      add(text, text.childNodes.length ? " " : null, `:${r.tag} now points at `, digestCode(r.lookup.digest), `; ${plural(r.behind, "container")} ${r.behind === 1 ? "runs" : "run"} `);
      stale.forEach((d, i) => add(text, i ? ", " : "", digestCode(d)));
      if (r.staleDigests.length > stale.length) add(text, ` and ${r.staleDigests.length - stale.length} more`);
      add(text, ".");
      text.title = "A pod runs the new build once its node pulls the tag again: when the pod starts with imagePullPolicy Always (the default for :latest), or on a node that does not have the old build.";
    }
    if (r.note) add(text, text.childNodes.length ? " " : null, r.note);
    if (!text.childNodes.length) return null;
    return add(el("div", "up-foot"), text);
  }
  function rowOf(r) {
    const node = el("article", "tag-row up-row " + r.state);
    const head = el("div", "tag-head");
    const mark = el("span", "up-mark " + r.state);
    mark.appendChild(icon(LOOK[r.state].icon));
    const checked = r.lookup ? ago(Date.parse(r.lookup.checkedAt)) : "";
    mark.title = LOOK[r.state].label + (checked ? ` · checked ${checked}` : "");
    const name = el("code", "repo-name", familiarRepository(r.entry.ref));
    name.title = r.key;
    const right = el("span", "tag-right");
    add(right, usedBy(r), registryLabel(r));
    const page = tagsPage(r.entry.ref);
    if (page) {
      const link = iconButton("open", page.label, () => sdk.openUrl(page.url).catch(fail));
      link.dataset.focus = "tags:" + r.key;
      right.appendChild(link);
    }
    add(head, mark, name, tagPill(r.entry), stateChips(r), right);
    node.appendChild(head);
    const foot = footOf(r);
    if (foot) node.appendChild(foot);
    return node;
  }
  function clearFilters() {
    state.query = "";
    state.show = "all";
    state.namespace = "";
    byId("query").value = "";
    byId("namespace").value = "";
    remember();
    keepFocus(byId("body"), drawBody);
  }
  function nothingShown() {
    const none = el("div", "none");
    const label = SHOWS.find((s) => s.id === state.show)?.label ?? "";
    const where = [state.query ? `“${state.query}”` : "", state.namespace ? `in ${state.namespace}` : ""].filter(Boolean).join(" ");
    const text = state.show === "all" ? `No image matches ${where}.` : `Nothing under ${label}${where ? " matches " + where : ""}.`;
    add(none, icon("search"), el("p", "", text));
    none.appendChild(button("Clear filters", "ghost small", "close", clearFilters));
    return none;
  }
  function drawList(report) {
    const list = byId("list");
    clear(list);
    const test = SHOWS.find((s) => s.id === state.show)?.test ?? (() => true);
    const shown = scoped(report).filter(test);
    if (!shown.length) {
      list.appendChild(nothingShown());
      return;
    }
    for (const r of shown) list.appendChild(rowOf(r));
  }
  function drawBody() {
    const report = state.report;
    if (!report) return;
    drawFilters(report);
    drawList(report);
  }
  var redrawBody = politely(byId("body"), drawBody);
  function drawWhere() {
    const parts = [state.ctx?.contextName ?? ""];
    const s = state.report?.summary;
    if (s) parts.push(plural(s.images, "image"));
    if (s && s.updates) parts.push(`${s.updates} with updates`);
    byId("where").textContent = parts.filter(Boolean).join(" · ");
  }
  function drawNamespaces() {
    const select = byId("namespace");
    if (document.activeElement === select) return;
    const rows = state.report?.rows ?? [];
    const counts = /* @__PURE__ */ new Map();
    for (const r of rows) for (const ns of r.namespaces) counts.set(ns, (counts.get(ns) ?? 0) + 1);
    const names = [.../* @__PURE__ */ new Set([...counts.keys(), ...state.namespace ? [state.namespace] : []])].sort();
    const want = [String(rows.length), ...names.map((ns) => `${ns}:${counts.get(ns) ?? 0}`)].join("|");
    if (select.dataset.options === want) return;
    select.dataset.options = want;
    clear(select);
    const anywhere = el("option", "", `Every namespace (${rows.length})`);
    anywhere.value = "";
    select.appendChild(anywhere);
    for (const ns of names) {
      const option = el("option", "", `${ns} (${counts.get(ns) ?? 0})`);
      option.value = ns;
      select.appendChild(option);
    }
    select.value = state.namespace;
  }
  function showControls(show) {
    byId("search").hidden = !show;
    byId("ns-pick").hidden = !show;
  }
  function drawInstead(title, ...text) {
    byId("main").hidden = true;
    showControls(false);
    const empty = byId("empty");
    empty.hidden = false;
    clear(empty);
    const art = el("div", "empty-art");
    art.appendChild(icon("update"));
    add(empty, art, el("h2", "", title), add(el("p", "faint"), ...text));
  }
  function drawAll() {
    const report = state.report;
    drawWhere();
    if (!report) return;
    if (!report.rows.length) {
      drawInstead("Nothing running to check", "No pod in this cluster runs a container right now. Once one does, its image is looked up here within a few seconds.");
      return;
    }
    byId("empty").hidden = true;
    byId("main").hidden = false;
    showControls(true);
    drawNamespaces();
    drawHero();
    if (report.signature === state.drawn) return;
    state.drawn = report.signature;
    redrawBody();
  }
  var drawTimer;
  function rebuild() {
    if (!state.inventory) return;
    state.report = buildUpdates(state.inventory, state.lookups);
    if (drawTimer !== void 0) return;
    drawTimer = setTimeout(() => {
      drawTimer = void 0;
      drawAll();
    }, DRAW_AFTER);
  }
  byId("logo").appendChild(icon("logo"));
  byId("search-icon").appendChild(icon("search"));
  var query = byId("query");
  query.value = state.query;
  query.addEventListener("input", () => {
    state.query = query.value;
    remember();
    drawBody();
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
    drawBody();
    nsSelect.blur();
  });
  var again = byId("again");
  add(again, icon("restart"), el("span", "", "Check again"));
  again.title = "Ask every registry again, rather than use the answers the app kept from the last half hour";
  again.addEventListener("click", () => {
    if (state.report && !asking()) ask(state.report.rows, true);
  });
  function onFeed(feed) {
    if (feed.errors.pods) banner.show(feed.errors.pods);
    else banner.clear();
    if (!feed.ready) return;
    const inv = buildInventory(feed.data);
    if (inv.signature === state.inventorySig) return;
    const first = !state.inventory;
    state.inventory = inv;
    state.inventorySig = inv.signature;
    rebuild();
    if (first) drawAll();
    if (state.report) ask(state.report.rows, false);
  }
  sdk.ready().then((ctx) => {
    state.ctx = ctx;
    drawWhere();
    if (typeof sdk.registry?.lookup !== "function") {
      drawInstead(
        "Updates needs K8s Dockside 0.0.25 or newer",
        "This page asks each image’s registry which tags it has, and only the app can do that on its behalf — this version of the app cannot yet. Update K8s Dockside to see which images have newer versions; the Overview and Images pages work as they are."
      );
      return;
    }
    if (!ctx.registries) {
      drawInstead(
        "This plugin does not ask to look up registries",
        "The app asks an image’s registry only for a plugin whose plugin.json says ",
        el("code", "", '"ui": { "registries": true }'),
        ". Add it, then press Reload in Settings → Plugins."
      );
      return;
    }
    startFeed(sdk, { fast: PODS_EVERY, slow: OWNERS_EVERY, onChange: onFeed });
  }).catch(fail);
})();
