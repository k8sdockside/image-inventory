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
  function workloadRef(kind2, namespace, name) {
    return { kind: kind2, appKind: APP_KINDS[kind2] ?? "", namespace, name, key: `${kind2}/${namespace}/${name}` };
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
    function declare(kind2, obj, template) {
      const workload = workloadRef(kind2, obj.metadata.namespace ?? "", obj.metadata.name);
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
    const has = (i, kind2) => i.issues.some((x) => x.kind === kind2);
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

  // src/model/selector.ts
  function selectorString(selector) {
    if (!selector) return "";
    const parts = [];
    const labels = selector.matchLabels ?? {};
    for (const key of Object.keys(labels).sort()) parts.push(`${key}=${labels[key] ?? ""}`);
    for (const req of selector.matchExpressions ?? []) {
      const values = (req.values ?? []).join(",");
      switch (req.operator) {
        case "In":
          parts.push(`${req.key} in (${values})`);
          break;
        case "NotIn":
          parts.push(`${req.key} notin (${values})`);
          break;
        case "Exists":
          parts.push(req.key);
          break;
        case "DoesNotExist":
          parts.push(`!${req.key}`);
          break;
        default:
          break;
      }
    }
    return parts.join(",");
  }
  function isOwnedBy(obj, uid) {
    if (!uid) return false;
    return (obj.metadata.ownerReferences ?? []).some((o) => o.uid === uid);
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
  function kindIcon(kind2) {
    switch (kind2) {
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
  function declined(err) {
    return /declined/.test(message(err));
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

  // src/pages/workload.ts
  var POLL = 5e3;
  var EVENTS_EVERY = 15e3;
  var RESTARTED_AT = "kubectl.kubernetes.io/restartedAt";
  var KINDS = { deployments: "Deployment", statefulsets: "StatefulSet", daemonsets: "DaemonSet", pods: "Pod" };
  var state = { ctx: null, object: null, pods: [], replicasets: [], events: [], owner: null, sig: "", restart: "idle", restartedAt: 0, eventsRead: false };
  function fail(err) {
    banner.show(err);
  }
  function kind() {
    return state.ctx?.object?.kind ?? "";
  }
  function isPod() {
    return kind() === "pods";
  }
  async function readPods(obj) {
    const ns = obj.metadata.namespace ?? "";
    const selector = selectorString(obj.spec?.selector);
    if (kind() === "deployments") {
      const [rs, pods] = await Promise.all([sdk.list({ kind: "replicasets", namespace: ns, selector }), sdk.list({ kind: "pods", namespace: ns, selector })]);
      state.replicasets = rs.filter((r) => isOwnedBy(r, obj.metadata.uid));
      const uids = state.replicasets.map((r) => r.metadata.uid);
      state.pods = pods.filter((p) => uids.some((uid) => isOwnedBy(p, uid)));
    } else {
      const pods = await sdk.list({ kind: "pods", namespace: ns, selector });
      state.pods = pods.filter((p) => isOwnedBy(p, obj.metadata.uid));
    }
  }
  async function readOwner(pod) {
    const ns = pod.metadata.namespace ?? "";
    const owner = controllerOf(pod);
    if (!owner || owner.kind === "Node") {
      state.owner = null;
      return;
    }
    const next = owner.kind === "ReplicaSet" ? "replicasets" : owner.kind === "Job" ? "jobs" : "";
    if (next) {
      try {
        const up = controllerOf(await sdk.get({ kind: next, namespace: ns, name: owner.name }));
        if (up && (up.kind === "Deployment" || up.kind === "CronJob")) {
          state.owner = { kind: up.kind, appKind: up.kind === "Deployment" ? "deployments" : "cronjobs", namespace: ns, name: up.name, key: `${up.kind}/${ns}/${up.name}` };
          return;
        }
      } catch {
      }
    }
    const appKinds = { ReplicaSet: "replicasets", StatefulSet: "statefulsets", DaemonSet: "daemonsets", Job: "jobs" };
    state.owner = { kind: owner.kind, appKind: appKinds[owner.kind] ?? "", namespace: ns, name: owner.name, key: `${owner.kind}/${ns}/${owner.name}` };
  }
  async function readEvents() {
    const ns = state.ctx?.object?.namespace ?? "";
    const names = new Set(state.pods.map((p) => p.metadata.name));
    const events = await sdk.list({ kind: "events", namespace: ns });
    state.events = events.filter((e) => e.involvedObject?.kind === "Pod" && names.has(e.involvedObject.name ?? ""));
  }
  async function tick() {
    const obj = await sdk.object();
    state.object = obj;
    if (isPod()) {
      state.pods = [obj];
      if (!state.owner) await readOwner(obj);
    } else {
      await readPods(obj);
    }
    if (!state.eventsRead) {
      state.eventsRead = true;
      every(EVENTS_EVERY, async () => {
        await readEvents();
        redraw();
      });
    }
    banner.clear();
    redraw();
  }
  function inventory() {
    const obj = state.object;
    if (!obj) return null;
    const data = { pods: state.pods, replicasets: state.replicasets, events: state.events };
    const w = obj;
    if (kind() === "deployments") data.deployments = [w];
    else if (kind() === "statefulsets") data.statefulsets = [w];
    else if (kind() === "daemonsets") data.daemonsets = [w];
    return buildInventory(data);
  }
  function templateContainers2() {
    const obj = state.object;
    const spec = isPod() ? obj.spec : obj.spec?.template?.spec;
    return [...(spec?.initContainers ?? []).map((container) => ({ container, init: true })), ...(spec?.containers ?? []).map((container) => ({ container, init: false }))];
  }
  function entriesFor(inv, name, init) {
    let current = null;
    const older = [];
    for (const entry of inv.images) {
      const u = entry.usages.find((x) => x.container === name && x.init === init);
      if (!u) continue;
      if (u.declared || isPod()) current = entry;
      else older.push(entry);
    }
    return { current, older };
  }
  function restartNote(inv) {
    const floating = inv.images.filter((i) => i.risk === "latest" || i.risk === "implicit" || i.risk === "floating");
    if (floating.length) {
      return `Restarting replaces every pod. With pull policy Always (the default for :latest), the new pods pull whatever ${floating.map((i) => familiar(i.ref)).join(", ")} points at now.`;
    }
    if (inv.images.every((i) => i.risk === "pinned")) return "Restarting replaces every pod; every image is pinned by digest, so they come back on exactly the same builds.";
    return "Restarting replaces every pod, one by one as the rollout strategy allows. A tag that was pushed again is pulled again only with pull policy Always.";
  }
  function drawHead(root, inv) {
    const head = el("div", "sec-head");
    const t = inv.totals;
    const containers = templateContainers2().length;
    const summary = el("div", "sec-summary");
    const tone = inv.images.some((i) => i.tone === "error") ? "error" : inv.images.some((i) => i.tone === "warn") ? "warn" : "ok";
    const pinned = inv.images.filter((i) => i.risk === "pinned" && i.usages.some((u) => u.declared || isPod())).length;
    add(
      summary,
      el("i", "sdot " + tone),
      el("strong", "", plural(containers, "container")),
      el("span", "faint", " · "),
      el("span", "", plural(t.images, "image")),
      el("span", "faint", " · "),
      el("span", pinned === t.images && t.images ? "ok-text" : "", pinned === t.images && t.images ? "all pinned by digest" : `${pinned} of ${t.images} pinned`)
    );
    head.appendChild(summary);
    if (isPod()) {
      if (state.owner) {
        const part = el("div", "sec-owner");
        add(part, el("span", "faint small", "Part of"), workloadButton(state.owner, (w) => w.appKind && sdk.open({ kind: w.appKind, namespace: w.namespace, name: w.name }).catch(fail), { namespace: false }));
        head.appendChild(part);
      }
    } else if (state.ctx?.write) {
      const b = button(state.restart === "asking" ? "Waiting for your answer…" : "Restart rollout", "small" + (state.restart === "asking" ? "" : " primary"), "restart", restart);
      b.disabled = state.restart === "asking";
      b.dataset.focus = "restart";
      b.title = restartNote(inv);
      head.appendChild(b);
    }
    root.appendChild(head);
  }
  function containerBlock(inv, container, init) {
    const { current, older } = entriesFor(inv, container.name, init);
    const box = el("article", "ctr " + (current?.tone ?? "muted"));
    const top = el("div", "ctr-top");
    const name = el("span", "ctr-name");
    add(name, icon(init ? "init" : "container"), el("span", "", container.name), init ? el("span", "badge", "init") : null);
    top.appendChild(name);
    top.appendChild(el("span", "push"));
    if (current && current.containers) top.appendChild(readiness(current.ready, current.containers, current.pulling));
    box.appendChild(top);
    if (!current) {
      box.appendChild(el("p", "quiet small", container.image ? "No pod runs this container yet." : "This container names no image."));
      return box;
    }
    const ref = current.ref;
    const image = el("div", "ctr-image");
    const code = el("code", "ctr-ref", container.image ?? current.key);
    code.title = current.key;
    add(image, code, tagPill(current));
    box.appendChild(image);
    const facts = el("div", "ctr-facts");
    const info = registryInfo(ref.registry);
    const fact = (label, value, title, className = "") => {
      const f = el("span", "ctr-fact" + (className ? " " + className : ""));
      add(f, el("span", "ctr-fact-label", label), el("span", "ctr-fact-value", value));
      if (title) f.title = title;
      return f;
    };
    add(
      facts,
      fact("Registry", info.label === ref.registry ? ref.registry : `${info.label} (${ref.registry})`, ref.implicitRegistry ? "Not written: Docker Hub is assumed" : void 0),
      fact("Repository", ref.repository || "—"),
      fact("Tag", ref.tag || (ref.digest ? "none — digest only" : "latest (not written)"), void 0, ref.tag && ref.tag.toLowerCase() !== "latest" ? "" : ref.digest ? "" : "warn"),
      ref.digest ? fact("Digest", shortDigest(ref.digest), ref.digest, "ok") : current.digests.length > 1 ? fact("Running", `${current.digests.length} different builds`, current.digests.join("\n"), "warn") : current.digests.length === 1 ? fact("Running", shortDigest(current.digests[0]), `The nodes pulled ${current.digests[0]} for this tag. Write it after the tag (…@${current.digests[0]}) to pin it.`) : fact("Running", current.containers ? "nothing pulled yet" : "no pod runs it"),
      fact(
        "Pull policy",
        container.imagePullPolicy || (ref.digest || ref.tag && ref.tag.toLowerCase() !== "latest" ? "IfNotPresent (default)" : "Always (default)"),
        "Unset, it is IfNotPresent -- or Always for :latest and an untagged image."
      )
    );
    box.appendChild(facts);
    const issues = current.issues.filter((i) => i.kind !== "idle" && i.kind !== "unpinned");
    for (const issue of issues) {
      const line = el("div", "ctr-issue " + issue.tone);
      add(line, issueChip(issue), el("span", "", issue.text));
      box.appendChild(line);
      const why = diagnosisBox(issue);
      if (why) box.appendChild(why);
    }
    for (const old of older) {
      const pods = old.usages.filter((u) => u.container === container.name && u.init === init).reduce((n, u) => n + u.pods.filter((p) => !p.finished).length, 0);
      if (!pods) continue;
      const line = el("div", "ctr-issue info");
      add(line, chip("rolling out", "info", "clock"), el("span", "", `${plural(pods, "pod")} still ${pods === 1 ? "runs" : "run"} ${familiar(old.ref, { shortDigest: true })} from before the last change.`));
      box.appendChild(line);
    }
    return box;
  }
  function draw() {
    const root = byId("root");
    clear(root);
    const inv = inventory();
    if (!inv) return;
    drawHead(root, inv);
    const list = el("div", "ctr-list");
    for (const { container, init } of templateContainers2()) list.appendChild(containerBlock(inv, container, init));
    root.appendChild(list);
    if (!isPod()) {
      const foot = el("div", "sec-foot");
      const annotations = state.object.spec?.template?.metadata?.annotations ?? {};
      const restartedAt = Date.parse(annotations[RESTARTED_AT] ?? "");
      if (state.restart === "done") {
        const ok = el("div", "notice");
        add(ok, icon("check"), el("span", "", "Restart applied — the pods are being replaced. This panel follows them as they come up."));
        foot.appendChild(ok);
      }
      const note = el("p", "faint small");
      const last = Number.isFinite(restartedAt) ? `Last restarted ${ago(restartedAt)}. ` : "";
      note.textContent = state.ctx?.write ? last + restartNote(inv) : last + 'This plugin is read-only here ("ui": { "write": false }), so it offers no restart.';
      foot.appendChild(note);
      root.appendChild(foot);
    } else if (state.owner && state.owner.kind !== "Pod") {
      root.appendChild(el("p", "faint small sec-foot", `To pull its images again, restart ${state.owner.kind} ${state.owner.name} — a pod’s images cannot change in place.`));
    }
    void sdk.resize(Math.ceil(document.documentElement.scrollHeight));
  }
  var drawPolitely = politely(document.body, draw);
  function redraw(force = false) {
    const inv = inventory();
    const sig = (inv?.signature ?? "") + "|" + state.restart + "|" + Math.floor(Date.now() / 6e4) + "|" + (state.object?.spec?.template?.metadata?.annotations?.[RESTARTED_AT] ?? "") + (state.owner?.key ?? "");
    if (sig === state.sig && !force) return;
    state.sig = sig;
    drawPolitely();
  }
  function restart() {
    const obj = state.ctx?.object;
    if (!obj || state.restart === "asking") return;
    state.restart = "asking";
    redraw(true);
    sdk.patch({
      kind: obj.kind,
      namespace: obj.namespace,
      name: obj.name,
      patch: { spec: { template: { metadata: { annotations: { [RESTARTED_AT]: (/* @__PURE__ */ new Date()).toISOString() } } } } }
    }).then(() => {
      state.restart = "done";
      state.restartedAt = Date.now();
      return tick();
    }).catch((err) => {
      state.restart = "idle";
      if (!declined(err)) fail(new Error("The restart was not applied: " + message(err)));
      redraw(true);
    });
  }
  sdk.ready().then((ctx) => {
    state.ctx = ctx;
    if (!ctx.object || !KINDS[ctx.object.kind]) {
      byId("root").textContent = "This page is a panel for a Deployment, StatefulSet, DaemonSet or Pod.";
      return;
    }
    every(POLL, tick);
    setInterval(() => {
      if (state.restart === "done" && Date.now() - state.restartedAt > 6e4) {
        state.restart = "idle";
        redraw(true);
      }
    }, 5e3);
  }).catch(fail);
})();
