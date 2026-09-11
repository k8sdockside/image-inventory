# Image inventory — an example K8s Dockside plugin in TypeScript

A plugin for the [K8s Dockside](https://github.com/rogerwesterbo/k8sdockside)
desktop app that shows **which container images run in the cluster**: where
they come from, which workloads and pods use each one, and which of them are
risky — failing to pull, not ready, running two builds of one tag, or floating
on `:latest`.

It works on **any cluster**: it reads only core kinds (pods, the workloads that
own them, and events), so you can install it and see it work immediately. It is
also written to be a template: the pages are TypeScript, bundled with esbuild,
typed against a complete declaration file for the bridge, and between them they
use nearly every call the bridge has.

Needs **K8s Dockside 0.0.15 or newer**. Prometheus is optional, for two charts.

## What it shows

**Overview** — replaces the app's generated overview page.

- A headline — *43 images from 11 registries across 12 namespaces* — with a
  verdict under it (*4 images are failing to pull*) and a sentence with the
  numbers that matter: containers and pods, what cannot be pulled, what is not
  ready, which tags run two builds, what floats on a moving tag, and how much is
  pinned by digest.
- **Where the images come from**: a ring of registries (Docker Hub, Quay,
  `registry.k8s.io`, GitHub, ECR, …) with each one's share.
- **Needs attention**: every risky image, worst first. A pull failure is
  explained in plain words — *the registry refused the credentials*, *that tag
  does not exist*, *the registry is rate-limiting pulls*, *there is no build for
  the node's CPU* — with what to check first and the node's own message. Also
  containers that are not ready, one tag running two different digests (it was
  pushed again after some nodes pulled it), `:latest`, untagged and moving tags,
  and images from the frozen `k8s.gcr.io`.
- **Most-run images** and **biggest users** (namespaces by how many different
  images they run, with their workloads one click away).
- Image pulls and distinct images over the last day, from the cluster's
  Prometheus when there is one.
- What the cluster serves, pods by phase, and the plugin's own links.

**Images** — the working page. Every image grouped registry → repository →
tag, searchable by image, tag, digest, workload, container, pod or node, and
filtered by namespace, by registry and by *Needs attention*, *Failing to pull*,
*Floating tags*, *Tagged, not pinned*, *Pinned by digest* or *Not running*.
Each tag shows how firmly it says which build runs, the digest the nodes
actually pulled, its readiness, and the workloads using it. Open a row for its
pods — state, node, restarts and the exact digest each one runs — with the
pod's logs, the workload's details and its YAML one click away. The search,
filters and open rows are kept in the page's address, so switching tabs and
back loses nothing.

**Images panel** in the detail view of every Deployment, StatefulSet,
DaemonSet and Pod: each container's image taken apart — registry, repository,
tag, digest, the build actually running, pull policy — with any pull failure
diagnosed and any older image still rolling out. Workloads get a **Restart
rollout** button: the same patch `kubectl rollout restart` makes (a new
`kubectl.kubernetes.io/restartedAt` annotation on the pod template), shown to
you by the app and applied only when you say yes. A pod's panel links to the
workload that owns it.

## Install

**Settings → Plugins → From a repository**, and paste

```
https://github.com/rogerwesterbo/k8sdockside-example-plugin-typescript
```

The app clones the repository into its plugins folder and gives the plugin's
card an **Update from repository** button. That is the whole install: the app
reads `plugin.json` and serves `ui/` as they are. **Nothing is built on
install**, which is why the built `ui/` folder is committed to this repository
alongside the TypeScript it is built from.

To work on it, use **Settings → Plugins → Watch another folder** and pick the
folder you cloned it into (or the folder above it). `package.json`,
`package-lock.json` and `tsconfig.json` are skipped by the loader, so only
`plugin.json` is read as a plugin.

## What it demonstrates

Every call on `window.k8sdockside`, and where to find it:

| Bridge call | Used for | File |
| --- | --- | --- |
| `ready()` | the context — cluster name, whether it may write, the object a panel is for, the plugin's links and version | every page |
| `watch()` | pods every 5 s, workloads and events every 15 s; a kind that cannot be read costs only what it would have added | `src/model/feed.ts` |
| `list()` | a workload's own ReplicaSets and pods, by its selector; a namespace's events | `src/pages/workload.ts` |
| `get()` | following a pod to its ReplicaSet and on to its Deployment | `src/pages/workload.ts` |
| `object()` | the workload a panel is drawn for, read live | `src/pages/workload.ts` |
| `namespaces()` | the namespace picker, with the ones that run nothing | `src/pages/images.ts` |
| `summary()` | "does the cluster answer", what it serves, pods by phase (the manifest's card) | `src/pages/overview.ts` |
| `charts()` | image pulls and distinct images from Prometheus, drawn as SVG | `src/pages/overview.ts`, `src/ui/charts.ts` |
| `patch()` | Restart rollout, confirmed by the user in the app; a "no" is not an error | `src/pages/workload.ts` |
| `open()` | a workload or pod in the app's details panel; a kind's own tab | all pages |
| `openView()` | the overview's Browse images | `src/pages/overview.ts` |
| `edit()`, `logs()` | a workload's YAML, a pod's logs | `src/pages/images.ts` |
| `openUrl()` | the plugin's links and the Kubernetes docs | `src/pages/overview.ts` |
| `resize()` | the panel settling its height after a redraw (the SDK also follows it) | `src/pages/workload.ts` |
| `on('theme')` | redrawing the charts, whose gradient stops take colours as values | `src/pages/overview.ts` |

`actions()` and `run()` are typed in `src/k8sdockside.d.ts` but not used: they
drive buttons declared in a manifest's `actions`, and there is nothing
image-related worth putting on every Deployment's action bar. The restart is
a `patch()` from the page instead, because it needs the current time in it.

The pure logic lives apart from the pages, with unit tests beside it:

| File | |
| --- | --- |
| `src/model/image-ref.ts` | image references taken apart as container runtimes read them — Docker Hub defaults and `library/`, ports in registry hosts, tags, digests, `imageID`s from containerd, CRI-O and dockershim — and how firmly a reference pins a build |
| `src/model/pull.ts` | why an image will not pull, in plain words, from the kubelet's messages and events |
| `src/model/selector.ts` | a label selector as the text `list()` takes |
| `src/model/inventory.ts` | the inventory: images grouped registry → repository → tag, the workloads and pods using each, and what is wrong with them |
| `src/k8sdockside.d.ts` | the bridge's types (below) |

## Develop

```sh
npm install
npm run watch      # rebuilds ui/ on every change under src/
```

Files under `ui/` are read fresh each time a view opens, so **reopen the tab**
to see a change. After editing `plugin.json`, press **Reload** in
**Settings → Plugins**.

| Script | |
| --- | --- |
| `npm run build` | bundles `src/` into `ui/` |
| `npm run watch` | the same, on every change |
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm test` | the unit tests (vitest) |
| `npm run check` | typecheck + tests + a fresh build compared with `ui/`; fails if `ui/` is out of date |

Before committing, run `npm run build` and commit `ui/` with your change —
`npm run check` (and CI) fail when the committed `ui/` is not what `src/`
builds to.

To check the manifest the way the app loads it — every field, kind, icon,
link, version, query and page — run the app's checker, as CI does:

```sh
go run github.com/rogerwesterbo/k8sdockside/cmd/plugincheck@main .
```

### How it is built

- **Classic scripts, not ES modules.** A plugin page runs in
  `<iframe sandbox="allow-scripts">` with an opaque origin, where
  `<script type="module">` is a cross-origin load not every webview allows.
  esbuild bundles each `src/pages/<page>.ts` on its own into `ui/<page>.js` as
  an IIFE (`format: 'iife'`), targeting Safari 16 — macOS draws plugin pages
  in WKWebView — and current Chromium (Windows) and WebKitGTK (Linux).
- **One script per page.** Each HTML file loads the bridge, then its own
  bundle:

  ```html
  <script src="/plugin-ui/_sdk/k8sdockside.js"></script>
  …
  <script src="overview.js"></script>
  ```

- **No network.** The page's Content-Security-Policy refuses `fetch`, XHR and
  websockets; everything about the cluster comes through `window.k8sdockside`.
  Bundle what you need — there are no runtime dependencies here at all.
- **The theme is free.** The SDK puts the app's colour tokens on `:root`
  (`--bg`, `--bg-panel`, `--bg-raised`, `--text`, `--text-dim`, `--text-faint`,
  `--accent`, `--ok`, `--warn`, `--error`, `--chart-1` … `--chart-8`,
  `--border`, …) and keeps them in step with the app.
- **Cluster data is text, never markup.** Everything from the cluster goes onto
  the page with `textContent` and DOM calls (`src/ui/dom.ts`), never
  `innerHTML`.
- **Polite redraws.** Pages poll, compare a fingerprint of what they would draw,
  and redraw only when it changed — and not while you are pressing a button,
  selecting text or typing in a field there; keyboard focus survives a redraw
  (`src/ui/page.ts`).
- **Hidden means hidden.** A global `[hidden] { display: none !important; }`
  keeps a class that sets `display` from overriding it.
- **Secrets are never readable** by a plugin page, whatever it declares, and
  this plugin does not ask. Every patch is shown to the user in the app first.

`scripts/build.mjs` is the whole build: esbuild plus a copy of
`src/pages/*.html` and `src/styles/*.css`, with nothing else in `ui/`. The only
dev dependencies are `typescript`, `esbuild` and `vitest`.

## The bridge's types

`src/k8sdockside.d.ts` declares `window.k8sdockside` completely — every call,
its parameters, what it resolves with, and the events `on()` takes — with the
documentation for each. It describes the bridge of K8s Dockside 0.0.15 and
newer and is self-contained (global declarations only, no imports), so you can
copy it into your own plugin as it is. Describe the fields you read by
extending `K8sDockside.KubeObject`:

```ts
interface Pod extends K8sDockside.KubeObject {
    spec?: { containers?: { name: string; image?: string }[] };
}
const pods = await k8sdockside.list<Pod>({ kind: 'pods', namespace: 'default' });
```

## Using it as a template

1. In `plugin.json`, change `id` (lowercase letters, digits and dashes — it is
   in every tab's identity, so pick it once), `name`, `tagline`, `icon`,
   `author`, `docs`, `links`, `description` and `version`.
2. Replace `requires` with the kinds your solution needs (`crd:<plural>.<group>`
   for custom resources), and `ui.kinds` with anything else your pages read.
   Drop `"write": true` if they never change anything.
3. Replace `views`, `sections`, `cards` and `charts` with your own; keep
   `overview` if you draw your own landing page.
4. Replace `src/pages/*` (an `.html` and a `.ts` per page — the build picks up
   every `src/pages/*.ts`), `src/model/*` and `src/styles/image-inventory.css`
   (rename it, and the `<link>` in each page). Keep `src/ui/` and
   `src/k8sdockside.d.ts` if they are useful.
5. Rename the package in `package.json`, rewrite this README, and run
   `npm run build` and commit `ui/`.

## License

Apache 2.0 — see [LICENSE](LICENSE).
