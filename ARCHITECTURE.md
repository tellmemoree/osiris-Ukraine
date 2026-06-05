# OSIRIS — Architecture & Agent Guide

> **Purpose:** a map of this codebase for AI agents, so we don't re-read the whole
> tree every session. **PRIME DIRECTIVE: when you add or materially change code,
> update the relevant section here in the same commit.** A stale map is worse than
> none. Keep it dense and accurate; cite file paths, not line numbers (they drift).
>
> See also: `AGENTS.md` (Next.js version warning), `HANDOFF.md` (bug/review
> follow-ups), `HANDOFF-recon-toolkit.md` (recon/cameras setup),
> `HANDOFF-feature-backlog.md` (groomed forward features).

## What this is
OSIRIS is a real-time OSINT / conflict-monitoring dashboard: a MapLibre globe with
toggleable intelligence layers (aviation, maritime, surveillance, hazards, threats,
Ukraine-war), a live-alerts feed, a markets panel, and a recon (OSINT) toolkit.

## Stack & hard constraints
- **Next.js 16.2.6, App Router.** This version has breaking changes vs. older Next —
  **read `node_modules/next/dist/docs/` before writing route/caching code** (per
  `AGENTS.md`). Cache Components / `use cache` are NOT enabled here.
- React 19, TypeScript (build ignores TS errors: `next.config.ts`
  `typescript.ignoreBuildErrors: true` — but keep `npx tsc --noEmit` clean anyway).
- MapLibre GL (`react-map-gl`/`maplibre-gl`), framer-motion, lucide-react, Tailwind.
- `output: 'standalone'`. ESLint is intentionally NOT build-enforced (huge inherited
  `no-explicit-any` debt — see HANDOFF.md #3, marked WON'T FIX). Keep NEW code clean.

## Core data flow (the loop that drives the map)
1. **`src/app/page.tsx`** is the dashboard shell + data orchestrator.
   - `dataRef.current` holds the merged data object; `setDataVersion(v=>v+1)` triggers
     re-render. `fetchEndpoint(url, transform?)` fetches and merges into `dataRef`.
   - **`LAYER_LOADERS`** (a `useMemo` map): `layerKey -> () => fetchEndpoint(...)`.
   - `loadOnce(key)` fetches a layer's data once (guarded by `layerFetchedRef`).
   - A `useEffect` watches `activeLayers` and calls `loadOnce` when a layer turns on.
   - A second `useEffect` sets up **per-layer polling** intervals for active layers.
   - `activeLayers` (a `useState` object) is the on/off state for every layer key.
2. **`src/components/OsirisMap.tsx`** renders everything via GeoJSON sources.
   - On init: a `sources` string[] is registered (each as an empty geojson source),
     then `map.addLayer(...)` calls define the visual layers.
   - **`setGeo(sourceId, features[])`** sets a source's data (wraps features in an FC).
   - Per-data `useEffect`s map `data.X` → features and call `setGeo`, gated by
     `activeLayers.X` (passing `[]` when off effectively hides the layer).
   - `setVis(ids, bool)` toggles layer visibility where needed.
3. **`src/components/LayerPanel.tsx`** is the toggle UI. **`LAYER_GROUPS`** defines
   grouped layers: `{ key, label, icon, color, dataKey }`. Groups: SDK, AVIATION,
   MARITIME & SPACE, SURVEILLANCE, NATURAL HAZARDS, THREATS & INFRA, UKRAINE WAR,
   DISPLAY. Group headers are click-to-toggle-all (ALL ON/OFF).

## ▶ RECIPE: add a new map layer
This exact 4-touch dance is how `frontlines`, `air_quality`, etc. were added:
1. **Route** — `src/app/api/<name>/route.ts` returning JSON (see route conventions).
2. **`page.tsx`** (4 edits):
   - add `<key>: false` to the `activeLayers` useState object;
   - add `<key>: () => fetchEndpoint('/api/<name>', d => ({ <dataKey>: d.<field> }))`
     to `LAYER_LOADERS`;
   - add `if (activeLayers.<key>) loadOnce('<key>');` to the layer-aware load effect;
   - (optional) add a polling `setInterval` in the polling effect.
3. **`LayerPanel.tsx`** — add `{ key, label, icon, color, dataKey }` to the right
   `LAYER_GROUPS` group (icon must be imported from lucide-react at top).
4. **`OsirisMap.tsx`** (3 edits):
   - add the source id to the `sources` array;
   - `map.addLayer(...)` for the visual (circle for points; fill+line for GeoJSON
     polygons — use `['get','color']`/`['get','fill']` for data-driven styling);
   - a `useEffect` that `setGeo('<source>', activeLayers.<key> && data.<dataKey> ? …)`.
Verify: `npx tsc --noEmit`, then `next dev -p 3002` and curl the route + load `/`.

## API route conventions (`src/app/api/*/route.ts`)
- **Caching pattern** (see `kab-threats`, `osint/shodan`, `ip-intel`): module-level
  `const cache = new Map(); const inflight = new Map();` + a TTL + inflight coalescing
  + a `Cache-Control` header. **Don't cache transient upstream failures** (only cache
  definitive results). For per-IP caches, trim/normalize the key.
- **Unconfigured = 503** (see `scanner`, `ip-intel`): if a required env key is unset,
  return `503 { error, hint }` instead of crashing. UI degrades gracefully.
- **SSRF guard** (`src/lib/ssrf-guard.ts`): `validateHost`, `isRateLimited`,
  `getClientIp` — use on routes that take user-supplied IPs/hosts.
- **Graceful degradation** (see `frontlines`): `Promise.allSettled` over multiple
  upstreams; succeed on whichever responds.
- **Cross-reference layers** (see `strategic-thermal`): a route may fetch a feed AND
  call another route internally via `new URL('/api/news', req.url)` to correlate them
  (here: FIRMS fires × curated sites + geolocated news → "thermal hit" AOIs). Cache the
  combined result. Distance checks use a cheap equirectangular approx (≈111.32 km/deg).
  A news item is a thermal lead only if `isStrikeRelated` AND **not** `isTerritorialAdvance`
  — capture/liberation reports ("освободила"/"под контроль"/"liberated") sit in ambient
  front-line FIRMS heat and carry combat verbs, so they were false positives; `ADVANCE_TERMS`
  uses PRECISE stems (no bare "occupied"/`наступ`) so genuine strikes near occupied areas
  survive. An article is cross-referenced at EVERY place `/api/news` `places[]` names, but
  only places with a fire within `NEWS_RADIUS_KM` surface (region-level mentions whose
  centroid has no nearby fire legitimately can't corroborate). Co-located corroborations
  (same ~0.05°/~5 km cell — multiple channels or both sides reporting one event) MERGE into
  ONE AOI carrying every contributing `sources[]` entry (not first-come-wins), surfaced in
  the OsirisMap thermal popup as "+N more report(s) here".
  Note: `/api/news` returns a **war/conflict-filtered** set (`isConflict`) — bilingual
  (English `RISK_KEYWORDS` + Cyrillic `CONFLICT_TERMS_CYR` stems) so RU/UA milblogger
  posts survive; keeps all conflicts, drops channel ads/sport/weather. Cyrillic stems
  must avoid common-word collisions (e.g. bare `наступ` matches "наступний"/next — use
  `наступальн`/`контрнаступ`). This feeds IntelFeed, LiveAlerts, and the `news_intel` dots.
  Geolocation is a hand-curated `KEYWORD_COORDS` gazetteer (Latin + Cyrillic UA/RU keys;
  `BROAD_KEYS` = country/peninsula, only used when no city is named). `keywordRegex` only
  APPENDS up to 4 case-suffix letters — it CANNOT swap a nominative's final vowel — so key
  declinable -а/-ка/-е place names on their CONSONANT STEM (`костянтинівк`, `судж`,
  `феодос`) to catch oblique cases. Two hazards when adding keys: (1) terminal-vowel
  declension as above; (2) common-word collisions (`лиман`=estuary, `украинск`/`українськ`
  =the adjective "Ukrainian", `орехов`=Moscow's Orekhovo) — validate every new key against
  a declined probe AND a false-friend probe before committing (see the `keywordRegex`
  harness pattern).
- **Actor-classified news layer** (see `captures`): the flip-side of `strategic-thermal`
  — where that route DROPS territorial-advance reports, `captures` SURFACES them as their
  own layer (`UA WAR` group, key `captures`). It reuses the same `ADVANCE_TERMS` (keep the
  two copies in sync) and classifies each item by the side that ADVANCED via `captureSide`
  — NOT the reporting channel's `side` (a UA channel routinely reports a RU capture). Each
  side's own euphemism is the signal: RU "освобод(ить)" → ru; UA "звільн"/"deoccupy"/
  "recapture" → ua; hostile "окуп/захопл/seized" framing → ru; else fall back to the army
  named. Plotted on the un-jittered raw centroid (recovered as the `places[]` entry nearest
  to `/api/news`'s jittered `coords`) so the same town from multiple channels dedups by
  place+side (count of corroborating reports); a town claimed by BOTH sides keeps two
  markers. Map styling: RU red `#FF3D3D`, UA blue `#2979FF`, flag-prefixed labels.
- **Snapshot/diff over time** (see `frontline-changes`): a route may persist a daily
  snapshot to `~/.osiris-data/<name>.json` (OUTSIDE the repo/`.next`, so it survives
  rebuilds) and return deltas. `frontline-changes` fetches `/api/frontlines`, sums all
  DeepState polygon areas (equirectangular shoelace), writes/refreshes today's UTC
  snapshot (capped at 120 days), and returns `delta_1d`/`delta_7d` (growth = RU
  expansion). Deltas are `null` until a second UTC day is recorded. Rendered by
  `src/components/FrontlineTracker.tsx` — a glass card shown bottom-right on desktop and
  in the mobile layers drawer, gated on `activeLayers.frontlines`.
- **Live in-memory AIS cache** (see `maritime`): a persistent `aisstream.io` WebSocket
  fills a `globalThis` ship cache (positions self-prune at 10 min). The route returns
  the **full** vessel set (no response cap). Shadow-fleet flagging is mostly IMO-based,
  and IMO arrives only in the infrequent type-5 `ShipStaticData` message — so the learned
  sanctioned-MMSI set is persisted to `~/.osiris-data/shadow-mmsi.json` and restored on
  startup, otherwise a restart would blind the layer for hours. Needs `AIS_API_KEY`; with
  no key the WS never connects and `ships` is empty (NOT a code bug — check the env first).

## Recon toolkit — `src/components/OsintPanel.tsx`
- `TABS` array defines tools `{ id, label, icon, placeholder, color }`.
- A `switch(activeTab)` builds the request URL; `if (activeTab === '<id>')` blocks
  render each tool's result. Helpers: `SectionHeader`, `ResultRow`,
  `renderFallbackExcluding`.
- **Plot a result on the map** via the `onScanGeolocate(target, {lat,lng,city,country,
  isp,type})` prop — feeds page `scanTargets` → OsirisMap `scan-targets` source. Reuse
  this instead of adding a new map source for one-off geolocated lookups.

## Env vars (gitignored `.env`; templates: `.env.example`, `.env.template`)
- `SHODAN_API_KEY` (free oss tier: host lookup works, host *search* needs paid) →
  `osint/shodan`. `CENSYS_API_ID`/`CENSYS_API_SECRET` → `ip-intel` (503 until set).
- `SCANNER_URL`/`SCANNER_KEY` → `scanner` (external active-scan backend; 503 until set).
- `AIS_API_KEY` → maritime AIS.
- `RU_PROXY_URL` → RU geoblock bypass via `src/lib/ru-fetch.ts` (`ruFetch()` helper,
  `undici` `ProxyAgent`). Unset = direct fetch, nothing breaks. Format: `http://user:pass@host:port`.
  Wired into `fetchRussiaCameras` in `cctv/route.ts`; insecam.org HTML parsing is TODO (task 3.1).
- Most feeds are keyless (aviation, fires, quakes, weather, news, air-raids, frontlines,
  air-quality via Open-Meteo).

## Branch & dev workflow
- **`osiris-Ukraine`** = active feature/tinkering branch (build features here).
  **`osiris-Ukraine-merged`** = integration/deploy branch = Ukraine features + master.
- **Two-branch, merge-NOT-fast-forward model** (the branches intentionally diverge — do
  NOT try to keep them FF-lockstep, that breaks the moment each side gets its own commits):
  - Feature work → commit on `osiris-Ukraine`, then **merge `osiris-Ukraine` into
    `osiris-Ukraine-merged`** (a real merge commit), push both.
  - Master sync → **merge `origin/master` into `osiris-Ukraine-merged`** (a fork upstream),
    resolving conflicts while keeping Ukraine features. Master does NOT go into
    `osiris-Ukraine` directly; it arrives there only if you later merge merged back.
  - `osiris-Ukraine-merged` is what gets deployed (carries both lines).
- Work **in place** (not git worktrees). Background-job worktree isolation is disabled for
  this repo via `.claude/settings.json` → `worktree.bgIsolation: "none"` (gitignored,
  machine-local) so in-place merges/edits aren't forced into an ephemeral worktree.
- Dev server runs on **:3001** (the home box), as a detached host process:
  `setsid npx next start -p 3001` (logs to `~/.osiris-server.log`). It serves the
  production build in `.next`.
- **Rebuild + restart :3001 after EVERY code change** (committed code isn't live until
  rebuilt — `next start` has no hot-reload): `npm run build`
  → if exit 0, kill the old listener's process group and relaunch
  `setsid bash -c 'exec npx next start -p 3001' </dev/null >~/.osiris-server.log 2>&1 &`,
  then health-check `curl :3001/api/health`. Build FIRST; only restart on success.
  **Send the `pkill`/`kill` as its OWN Bash call** — chaining commands after it aborts
  them (exit 144); relaunch in a separate call.
  `next start` warns about `output: 'standalone'` but serves fine here; standalone is
  for the Docker prod build (separate machine), so leave the config as-is. Restart is
  also required to pick up `.env` changes (e.g. after pasting the Censys key).
- For one-off verification use a throwaway `next dev -p 3002` and tear it down; never
  disturb :3001. (Note: `next dev` writes into the shared `.next`, so rebuild before
  relying on :3001 again.)

## CI/CD (`.github/`)
- **`workflows/ci.yml`** — on push to `master`/`osiris-Ukraine`/`osiris-Ukraine-merged`
  and all PRs: `npm ci` → `tsc --noEmit` (blocking) → `npm run lint` (advisory,
  `continue-on-error` — inherited `no-explicit-any` debt is WON'T FIX) → `npm run build`
  (blocking). Node 22, npm cache.
- **`workflows/docker-publish.yml`** — on push to the deploy branch
  `osiris-Ukraine-merged` (and `v*` tags): builds the standalone `Dockerfile`,
  smoke-tests `/api/health` on the local image, then pushes to GHCR
  (`ghcr.io/<repo>`). PRs build + smoke-test but do NOT push. `latest` tag tracks
  `osiris-Ukraine-merged`. Uses GHA build cache.
- **`workflows/codeql.yml`** — JS/TS static security analysis (push/PR to
  `master`/`osiris-Ukraine-merged` + weekly cron). Fits the SSRF-guarded, IP/host-input
  surface (see SECURITY.md).
- **`dependabot.yml`** — weekly npm (grouped minor/patch; `next` major ignored — pinned
  fork) + github-actions updates, targeting `osiris-Ukraine-merged`.

## Render deployment (`render.yaml`)
`render.yaml` (repo root) is a Render Blueprint. Connect the repo at
`https://dashboard.render.com/` → New → Blueprint → point at this repo.
Render builds from `Dockerfile` directly (free plan, region: oregon, port 3000).
After deploy, set these env vars in the Render dashboard (marked `sync: false` in the
blueprint so secrets are never committed):
- `SHODAN_API_KEY`
- `CENSYS_API_ID` (PAT or legacy id)
- `CENSYS_API_SECRET` (leave blank for PAT)
- `AISSTREAM_API_KEY`
Health check: `/api/health`. Free tier sleeps after 15 min idle (30s cold start).

## Gotchas / known-dead upstreams (verify before trusting a "dark" route)
- A route returning empty often means its UPSTREAM died, not that it's un-wired:
  - **DeepState** (`frontlines`) nests features under `.map.features`, not `.features`.
  - **OpenAQ v2** is HTTP **410 Gone** → `air-quality` now uses keyless **Open-Meteo**.
  - **Militaryland** front-line geojson is **404** → `frontlines` degrades to DeepState.
- `scm-suppliers` route exists but was deliberately removed from the UI (master V2).
- Loose one-off scripts at repo root were pruned (HANDOFF.md #10); keep
  `scripts/restore_telegeography_cables.js` (real cable-data regenerator) and
  `scripts/sdk_ingester.js` (dev seeder for `/api/sdk/ingest`).
