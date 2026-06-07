# OSIRIS Feature Architecture Review
> Audited 2026-06-07. Branch: `osiris-Ukraine`. All findings reference named symbols, not line numbers.

---

## Summary

**14 findings across all shipped layers.** Two are P1 correctness issues (one security-adjacent, one silent data loss). Six are P2 convention violations. Six are P3 polish items. No shipped layer is completely broken, but several have caching, visibility, and dead-code gaps that will cause hard-to-diagnose problems at scale.

---

## Audit: `/api/news` (news route)

### 4-touch recipe
| Check | Status | Notes |
|-------|--------|-------|
| LAYER_LOADERS entry | ✅ | `news_intel: (implicit)` — news is fetched unconditionally on load, not through LAYER_LOADERS |
| OsirisMap source | ✅ | `sigint-news` source registered |
| addLayer call | ✅ | `sigint-news-glow`, `sigint-news-dots`, `sigint-news-label` |
| setGeo useEffect | ✅ | gated on `activeLayers.news_intel` and `replayTime` |
| LayerPanel entry | ✅ | `LAYER_GROUPS[SURVEIL]` → key `news_intel` |

### Caching
| Check | Status | Notes |
|-------|--------|-------|
| Module-level cache + inflight | ❌ | No module-level cache variables exist. Every request re-scrapes all 29 Telegram channels |
| Cache-Control header | ✅ | `public, s-maxage=60, stale-while-revalidate=120` set on success path |
| TTL appropriate | ⚠️ | `s-maxage=60` tells CDN to cache 60 s, but the route re-scrapes Telegram on every server hit because there is no in-memory cache |
| Upstream failures excluded | ✅ | Individual channel failures are caught and skipped |

### Convention compliance
| Check | Status | Notes |
|-------|--------|-------|
| `export const dynamic` | ❌ | Missing. Without `force-dynamic`, Next.js may attempt to statically render the route — benign now but becomes a build error if a `use cache` layer is ever added |
| SSRF guard | ✅ | Route only fetches its own hard-coded channel list; no user-supplied input |

### Polling
| Check | Status | Notes |
|-------|--------|-------|
| Polling interval | ✅ | 3 min (`180000 ms`) in the unconditional polling effect |
| Interval appropriate | ✅ | Reasonable for Telegram scraping with no rate-limit backoff |

---

## Audit: `/api/strategic-thermal` (thermal_aoi layer)

### 4-touch recipe
| Check | Status | Notes |
|-------|--------|-------|
| LAYER_LOADERS entry | ✅ | `thermal_aoi: () => fetchEndpoint('/api/strategic-thermal', d => ({ thermal_aoi: d.aois }))` |
| OsirisMap source | ✅ | `thermal-aoi` registered |
| addLayer call | ✅ | `thermal-aoi-glow`, `thermal-aoi-dots`, `thermal-aoi-label` |
| setGeo useEffect | ✅ | gated on `activeLayers.thermal_aoi`, `data.thermal_aoi`, and `replayTime` |
| LayerPanel entry | ✅ | `LAYER_GROUPS[UA WAR]` → key `thermal_aoi` |
| setVis call | ⚠️ | `thermal-aoi-*` layers are **absent from the visibility `useEffect`** in OsirisMap; visibility is controlled entirely by `setGeo([])` on toggle-off, which is correct but fragile — layer becomes invisible immediately after toggle-off but does not respond to `setVis` |

### Caching
| Check | Status | Notes |
|-------|--------|-------|
| Module-level cache + inflight | ❌ | No module-level cache. Route has `export const dynamic = 'force-dynamic'` but no `let cached / let inflight` |
| Cache-Control header | ✅ | `public, s-maxage=600, stale-while-revalidate=1200` (10 min) |
| TTL appropriate | ✅ | FIRMS data is 24h CSV; 10-min cache is reasonable |
| Upstream failures excluded | ✅ | FIRMS and news failures propagate to a 500 with error body |

### Convention compliance
| Check | Status | Notes |
|-------|--------|-------|
| `export const dynamic` | ✅ | Present |
| SSRF guard | ✅ | Uses `new URL('/api/news', req.url)` for the internal news call — resolves to the same process, no user input |

### Polling
| Check | Status | Notes |
|-------|--------|-------|
| Polling interval | ✅ | 5 min (`300000 ms`) |

### replayTime integration
| Check | Status | Notes |
|-------|--------|-------|
| replayTime-aware | ✅ | `useEffect` in OsirisMap filters by `latest` timestamp ≤ `replayTime` |

---

## Audit: `/api/captures` (captures layer)

### 4-touch recipe
| Check | Status | Notes |
|-------|--------|-------|
| LAYER_LOADERS entry | ✅ | `captures: () => fetchEndpoint('/api/captures', d => ({ captures: d.captures }))` |
| OsirisMap source | ✅ | `captures` registered |
| addLayer call | ✅ | `capture-glow`, `capture-dots` |
| setGeo useEffect | ✅ | gated on `activeLayers.captures`, `data.captures`, and `replayTime` |
| LayerPanel entry | ✅ | `LAYER_GROUPS[UA WAR]` → key `captures` |
| setVis call | ⚠️ | `capture-glow`, `capture-dots` absent from the visibility `useEffect`; same fragility as thermal_aoi |
| capture-label layer | ❌ | No label layer defined in `addLayer`; the popup shows the name but there's no on-map text label — this may be intentional but is undocumented |

### Caching
| Check | Status | Notes |
|-------|--------|-------|
| Module-level cache + inflight | ❌ | No module-level cache. Route internally fetches `/api/news` on every request |
| Cache-Control header | ✅ | `public, s-maxage=300, stale-while-revalidate=600` (5 min) |
| Upstream failures excluded | ✅ | Returns 500 with error body on failure |

### Convention compliance
| Check | Status | Notes |
|-------|--------|-------|
| `export const dynamic` | ✅ | Present |
| SSRF guard | ✅ | No user-supplied input |

### Polling
| Check | Status | Notes |
|-------|--------|-------|
| Polling interval | ✅ | 5 min (`300000 ms`) |

### replayTime integration
| Check | Status | Notes |
|-------|--------|-------|
| replayTime-aware | ✅ | `useEffect` in OsirisMap filters by `date` field ≤ `replayTime` |

---

## Audit: `/api/kab-threats` (kab_threats layer)

### 4-touch recipe
| Check | Status | Notes |
|-------|--------|-------|
| LAYER_LOADERS entry | ✅ | `kab_threats: () => fetchEndpoint('/api/kab-threats', d => ({ kab_threats: d.threats }))` |
| OsirisMap source | ✅ | `kab-threats` registered |
| addLayer call | ✅ | `kab-glow`, `kab-dots`, `kab-label` |
| setGeo useEffect | ✅ | gated on `activeLayers.kab_threats`, `data.kab_threats`, and `replayTime` |
| LayerPanel entry | ✅ | `LAYER_GROUPS[UA WAR]` → key `kab_threats` |
| setVis call | ✅ | Present in visibility `useEffect` |

### Caching
| Check | Status | Notes |
|-------|--------|-------|
| Module-level cache + inflight | ✅ | `let cached`, `let cachedAt`, `let inflight` with 60 s TTL — fully compliant |
| Cache-Control header | ✅ | `public, s-maxage=60, stale-while-revalidate=120` on all code paths |
| Upstream failures excluded | ✅ | Catch block returns empty threats without caching |

### Convention compliance
| Check | Status | Notes |
|-------|--------|-------|
| `export const dynamic` | ❌ | **MISSING.** Route has module-level mutable state (`let cached`, `let cachedAt`, `let inflight`). Without `force-dynamic`, Next.js 16 may static-render this route at build time, discarding the in-memory cache on every cold start and making the inflight coalescing ineffective |
| SSRF guard | ✅ | No user-supplied input |

### Polling
| Check | Status | Notes |
|-------|--------|-------|
| Polling interval | ✅ | 1 min (`60000 ms`) — matches 60 s cache TTL |

### replayTime integration
| Check | Status | Notes |
|-------|--------|-------|
| replayTime-aware | ✅ | `useEffect` filters by `startedAt` ≤ `replayTime` |

---

## Audit: `/api/air-raids` (air_raids layer)

### 4-touch recipe
| Check | Status | Notes |
|-------|--------|-------|
| LAYER_LOADERS entry | ✅ | `air_raids: () => fetchEndpoint('/api/air-raids', d => ({ air_raids: d.alerts }))` |
| OsirisMap source | ✅ | `air-raid-alerts` registered (distinct name from source key — intentional) |
| addLayer call | ✅ | `raid-glow`, `raid-dots`, `raid-label` + static oblast/district fill layers |
| setGeo useEffect | ✅ | gated on `activeLayers.air_raids`; also updates `setFilter` on oblast/district fill layers |
| LayerPanel entry | ✅ | `LAYER_GROUPS[UA WAR]` → key `air_raids` |
| setVis call | ✅ | Present in visibility `useEffect` |

### Caching
| Check | Status | Notes |
|-------|--------|-------|
| Module-level cache + inflight | ❌ | No module-level cache. Every request hits `vadimklimenko.com` live |
| Cache-Control header | ✅ | `public, s-maxage=60, stale-while-revalidate=120` |
| Upstream failure response | ❌ | When vadimklimenko returns non-200, the route returns **HTTP 200 with `{ alerts: [], error: "..." }`**. The `fetchEndpoint` utility's empty-array guard in `page.tsx` will then keep the last good data (correct), but the response status is misleading and logging is lost |
| TTL appropriate | ✅ | 60 s is correct for a live alert feed |

### Convention compliance
| Check | Status | Notes |
|-------|--------|-------|
| `export const dynamic` | ❌ | Missing. No module-level cache state here, but route fetches live data — should be `force-dynamic` to guarantee freshness |
| SSRF guard | ✅ | No user input |

### Polling
| Check | Status | Notes |
|-------|--------|-------|
| Polling interval | ✅ | 1 min (`60000 ms`) |

### replayTime integration
| Check | Status | Notes |
|-------|--------|-------|
| replayTime-aware | ⚠️ | `air_raids` useEffect in OsirisMap does **not** filter by `replayTime`. Air raid alerts have `startedAt` timestamps but scrubbing does not hide/show them. The `air_raids` event type is also missing from the `TimelineControl` histogram. Per the backlog (2.4), this is a known Phase 2 gap — but it should be flagged |

---

## Audit: `/api/frontlines` (frontlines layer)

### 4-touch recipe
| Check | Status | Notes |
|-------|--------|-------|
| LAYER_LOADERS entry | ✅ | `frontlines: () => fetchEndpoint('/api/frontlines', d => ({ frontlines: d.frontlines?.features \|\| [] }))` |
| OsirisMap source | ✅ | `frontlines` registered |
| addLayer call | ✅ | `frontline-fill`, `frontline-line` |
| setGeo useEffect | ✅ | gated on `activeLayers.frontlines` and `data.frontlines` |
| LayerPanel entry | ✅ | `LAYER_GROUPS[UA WAR]` → key `frontlines` |
| setVis call | ⚠️ | `frontline-fill` and `frontline-line` absent from visibility `useEffect`; controlled by `setGeo([])` only |

### Caching
| Check | Status | Notes |
|-------|--------|-------|
| Module-level cache + inflight | ❌ | No module-level cache. Every request hits DeepState live |
| Cache-Control header | ✅ | `public, s-maxage=1800, stale-while-revalidate=3600` (30 min) |
| Upstream failure | ✅ | Returns 502 when DeepState fails — correct status code |
| TTL appropriate | ✅ | 30 min is appropriate; the route has a matching 30-min poll in `page.tsx` |

### Convention compliance
| Check | Status | Notes |
|-------|--------|-------|
| `export const dynamic` | ❌ | Missing |
| SSRF guard | ✅ | No user input |

### replayTime integration
| Check | Status | Notes |
|-------|--------|-------|
| replayTime-aware | ❌ | Frontline polygons carry no timestamps so replayTime cannot filter them — architecturally correct, but `frontlines` events are also absent from the `TimelineControl` histogram, which is consistent |

---

## Audit: `/api/frontline-changes` (FrontlineTracker)

### Architecture compliance
| Check | Status | Notes |
|-------|--------|-------|
| Snapshot persistence | ✅ | Writes to `~/.osiris-data/frontline-history.json`, survives rebuilds |
| Delta computation | ✅ | `delta_1d` / `delta_7d` both nullable until 2+ days accumulated |
| Data consumer | ✅ | `FrontlineTracker.tsx` polls at 1 h interval |
| Decoupled from layer toggle | ✅ | Triggered by `showFrontlineTracker` state, independent of `activeLayers.frontlines` — per backlog 2.1 spec |

### Caching
| Check | Status | Notes |
|-------|--------|-------|
| Module-level cache + inflight | ⚠️ | No module-level cache. Route fetches DeepState live on every request. FrontlineTracker polls hourly — low frequency mitigates this, but simultaneous requests (e.g., two open browser tabs) will cause concurrent DeepState fetches |
| `export const dynamic` | ✅ | Present |
| Cache-Control header | ❌ | No `Cache-Control` header set on the response. Consumers get no CDN caching signal |

---

## Audit: `/api/digest` (BriefingPanel / Telegram)

### Architecture compliance
| Check | Status | Notes |
|-------|--------|-------|
| Module-level cache | ✅ | `let cache`, `let cacheTs` with 1-hour TTL |
| `export const dynamic` | ✅ | Present |
| Graceful no-key degradation | ✅ | Falls back to a raw-text digest when `GEMINI_API_KEY_*` is unset |
| inflight coalescing | ❌ | No `inflight` guard. Two simultaneous requests both hit the 5 downstream APIs — could generate duplicate Telegram messages if the 1-hour cache has just expired |

### Caching
| Check | Status | Notes |
|-------|--------|-------|
| Cache-Control header | ✅ | `no-store` — correct, digest is personalized / time-sensitive |
| Upstream failure exclusion | ✅ | `Promise.allSettled` prevents partial failures from crashing the route |

### Convention compliance
| Check | Status | Notes |
|-------|--------|-------|
| SSRF guard | ✅ | `?force=1` only controls cache busting, not any remote fetch target |

---

## Audit: `/api/gdelt` (global_incidents layer)

### 4-touch recipe
| Check | Status | Notes |
|-------|--------|-------|
| LAYER_LOADERS entry | ⚠️ | Key is `gdelt` in LAYER_LOADERS but `global_incidents` in `activeLayers` and LayerPanel. The layer-toggle load effect uses `if (activeLayers.global_incidents) loadOnce('gdelt')` — **this works** but the LAYER_LOADERS key and activeLayers key are inconsistent, violating the convention where they should match |
| OsirisMap source | ✅ | `gdelt` registered |
| addLayer call | ✅ | `gdelt-dots` |
| setGeo useEffect | ✅ | gated on `activeLayers.global_incidents`, `data.gdelt`, and `replayTime` |
| LayerPanel entry | ✅ | key `global_incidents`, dataKey `gdelt` |
| setVis call | ✅ | Present |

### Caching
| Check | Status | Notes |
|-------|--------|-------|
| Module-level cache + inflight | ❌ | No module-level cache |
| Cache-Control header | ✅ | `public, s-maxage=300, stale-while-revalidate=600` (5 min) |
| `export const dynamic` | ✅ | Present |

### Polling
| Check | Status | Notes |
|-------|--------|-------|
| Polling interval | ❌ | **No polling interval for `gdelt` / `global_incidents` in the layer-aware polling effect.** The layer loads once on toggle but never refreshes. GDELT events are time-stamped; without polling, the histogram and map stale out after the initial load |

### replayTime integration
| Check | Status | Notes |
|-------|--------|-------|
| replayTime-aware | ✅ | `useEffect` filters by `published` ≤ `replayTime` |

---

## Cross-cutting Dead Code / Drift

### `war_alerts` — orphaned layer key

| Check | Status | Notes |
|-------|--------|-------|
| In `activeLayers` | ✅ | Initialized as `false` |
| In `LAYER_LOADERS` | ❌ | **No entry** — toggle on does nothing |
| In LayerPanel | ❌ | **No entry** — invisible to the user |
| In OsirisMap sources | ✅ | `war-alerts-targets` and `war-alerts-lines` registered but never populated via `setGeo` |
| setGeo call | ❌ | No useEffect writes to `war-alerts-targets` or `war-alerts-lines` |

**Verdict:** Full dead-code path. Sources occupy memory on every map init. Either complete the feature or remove the sources and the `war_alerts` key from `activeLayers`.

---

### `gps_jamming` — data source missing

| Check | Status | Notes |
|-------|--------|-------|
| In `activeLayers` | ✅ | `false` |
| In `LAYER_LOADERS` | ❌ | **No entry** |
| In LayerPanel | ✅ | `LAYER_GROUPS[THREAT]` → key `gps_jamming` |
| In OsirisMap addLayer | ✅ | `jam-fill`, `jam-label` |
| setGeo useEffect | ✅ | gated on `activeLayers.gps_jamming && data.gps_jamming` |
| setVis call | ✅ | Present |

**Verdict:** Toggle exists in the UI and OsirisMap has full visual wiring, but `data.gps_jamming` is never populated — there is no LAYER_LOADERS entry and no API route consuming a GPS jamming feed. Layer appears in LayerPanel, toggle does nothing, map shows nothing. This is a silently broken layer — P1 for user confusion.

---

### `conflict_zones` — undeclared key in activeLayers

| Check | Status | Notes |
|-------|--------|-------|
| In `activeLayers` | ❌ | **Not declared** in the `useState` initializer |
| In OsirisMap visibility | ⚠️ | `setVis(['conflict-icons'], activeLayers.conflict_zones !== false)` — evaluates `undefined !== false` → `true`, so the layer is always visible regardless of any toggle |
| In LayerPanel | ❌ | No entry |

**Verdict:** The `conflict-icons` layer (global conflict zone markers) is hardwired on with no user toggle path. The `conflict_zones` key in `activeLayers` is undefined but `undefined !== false` keeps it visible always. This is an undocumented always-on layer — acceptable if intentional, but the intent should be recorded and the expression simplified to just `true` to avoid the misleading guard.

---

### `thermal_aoi` / `captures` / `frontlines` — missing from setVis block

All three layers use `setGeo([])` to blank out when toggled off. This is architecturally valid, but it bypasses MapLibre's visibility layer-property, meaning:

- Inspect-mode queries (e.g. `map.queryRenderedFeatures`) will still return features from nominally hidden layers until the next data update.
- If `setGeo` is ever called before `mapReady` transitions, the layers remain visible with stale data.

Mitigating factor: the `useEffect` dependency on `activeLayers.X` means the setGeo-to-empty call fires promptly on toggle. Risk is low but non-zero.

---

## Priority Fixes

### P1 — Correctness / Security

**P1-A: `kab-threats/route.ts` — add `export const dynamic = 'force-dynamic'`**
- File: `src/app/api/kab-threats/route.ts`
- Change: Add `export const dynamic = 'force-dynamic';` after the imports, before the JSDoc
- Why: Route has module-level mutable state (`let cached`, `let cachedAt`, `let inflight`). Without `force-dynamic`, Next.js 16 App Router may pre-render the route at build time, making module-level cache variables inaccessible or reset on each cold start. The inflight coalescing becomes a no-op, and concurrent Telegram scrapes can exceed channel rate limits.

**P1-B: `gps_jamming` — either add a LAYER_LOADERS entry + route, or remove from LayerPanel**
- File: `src/components/LayerPanel.tsx` → `LAYER_GROUPS[THREAT]`
- File: `src/app/page.tsx` → `LAYER_LOADERS` and the layer-load effect
- Why: Layer is visible in the toggle UI and its `setGeo`/`setVis` wiring exists in OsirisMap, but `data.gps_jamming` is never populated. User toggles the layer, nothing appears. Silent feature breakage.
- Options: (a) Add a GPS-jamming data source and complete the LAYER_LOADERS entry, (b) remove the LayerPanel entry and the `gps_jamming` key from `activeLayers`.

---

### P2 — Convention / Quality

**P2-A: `air-raids/route.ts` — add `export const dynamic = 'force-dynamic'`**
- File: `src/app/api/air-raids/route.ts`
- Change: Add `export const dynamic = 'force-dynamic';` after the imports
- Why: Route fetches live vadimklimenko data; it must never be statically cached by the build system.

**P2-B: `frontlines/route.ts` — add `export const dynamic = 'force-dynamic'`**
- File: `src/app/api/frontlines/route.ts`
- Change: Same as P2-A
- Why: Same rationale — live upstream fetch.

**P2-C: `news/route.ts` — add module-level cache + `export const dynamic`**
- File: `src/app/api/news/route.ts`
- Change: Add `export const dynamic = 'force-dynamic';` and a module-level `let newsCache / let newsCachedAt / let newsInflight` with ~3-minute TTL matching the polling interval
- Why: Route currently re-scrapes all 29 Telegram channels on every request. With 3-minute polling from the dashboard, back-channel requests (digest, threshold-alerts, strategic-thermal, captures all call `/api/news` internally), concurrent browser tabs, and the BriefingPanel, the effective request rate is well above what `s-maxage` on a CDN-free self-hosted box covers. Module-level cache coalesces all of these.

**P2-D: `gdelt/route.ts` — add polling interval in `page.tsx`**
- File: `src/app/page.tsx` → layer-aware polling effect
- Change: Add `if (activeLayers.global_incidents) intervals.push(setInterval(() => fetchEndpoint('/api/gdelt', d => ({ gdelt: d.events })), 300000));` (5 min, matching Cache-Control TTL)
- Why: `global_incidents` layer loads once on toggle but never refreshes. GDELT data is time-indexed and the timeline histogram shows `gdelt` events — stale data makes the scrubber misleading.

**P2-E: `air-raids/route.ts` — return 502 on upstream failure instead of 200**
- File: `src/app/api/air-raids/route.ts`, inside the `if (!res.ok)` branch
- Change: Add `{ status: 502 }` as the second argument to `NextResponse.json(...)` when vadimklimenko returns non-2xx
- Why: The current 200 response with `{ alerts: [], error: "..." }` is indistinguishable from a genuine "no active alerts" state at the HTTP level. The `page.tsx` empty-array guard prevents data loss, but logging and monitoring cannot distinguish upstream failure from quiet periods.

**P2-F: `digest/route.ts` — add inflight coalescing**
- File: `src/app/api/digest/route.ts`
- Change: Add `let digestInflight: Promise<...> | null = null;` and wrap the fetch block with inflight guard (same pattern as `kab-threats`)
- Why: Two simultaneous requests at cache expiry both fetch all 5 downstream APIs and both may send a Telegram message, causing duplicate notifications.

---

### P3 — Polish / Completeness

**P3-A: Remove `war_alerts` dead code**
- Files: `src/app/page.tsx` (remove `war_alerts: false` from activeLayers), `src/components/OsirisMap.tsx` (remove `war-alerts-targets` and `war-alerts-lines` from the `sources` array)
- Why: Sources are registered and wasted on every map init. No load path, no UI toggle, no data.

**P3-B: Clarify `conflict_zones` always-on visibility**
- File: `src/components/OsirisMap.tsx` → visibility `useEffect`
- Change: Replace `setVis(['conflict-icons'], activeLayers.conflict_zones !== false)` with just `setVis(['conflict-icons'], true)` and add a comment `// conflict-icons are always-on — no user toggle`
- Why: The current expression is misleading. The `undefined !== false` pattern suggests a toggle guard exists when none does.

**P3-C: Add `Cache-Control` header to `frontline-changes/route.ts`**
- File: `src/app/api/frontline-changes/route.ts`
- Change: Add `headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' }` to the success response
- Why: FrontlineTracker polls hourly; giving the CDN / browser a 1-hour cache hint prevents redundant re-fetches from multiple tabs.

**P3-D: Add `setVis` calls for `thermal-aoi`, `capture`, and `frontline` layers**
- File: `src/components/OsirisMap.tsx` → visibility `useEffect`
- Change: Add `setVis(['thermal-aoi-glow','thermal-aoi-dots','thermal-aoi-label'], activeLayers.thermal_aoi)`, `setVis(['capture-glow','capture-dots'], activeLayers.captures)`, `setVis(['frontline-fill','frontline-line'], activeLayers.frontlines)`
- Why: Currently these layers are hidden by `setGeo([])` only. Adding `setVis` provides the defense-in-depth that MapLibre's visibility property gives and prevents `queryRenderedFeatures` from returning features from hidden layers.

**P3-E: Add `air_raids` to replayTime filtering in OsirisMap**
- File: `src/components/OsirisMap.tsx` → air-raids `useEffect` (the one that calls `setGeo('air-raid-alerts', ...)`)
- Change: Filter `alerts` by `startedAt <= cutoffMs` when `replayTime` is set, matching the pattern in the `kab-threats` useEffect. Also add `replayTime` to the useEffect dependency array.
- Why: KAB threats filter by replayTime; air raids do not. The two layers are shown together and having one respond to scrubbing while the other does not creates inconsistent behavior.

**P3-F: Align LAYER_LOADERS key `gdelt` ↔ `activeLayers` key `global_incidents`**
- File: `src/app/page.tsx` → `LAYER_LOADERS` object
- Change: Rename the LAYER_LOADERS key from `gdelt` to `global_incidents`, update `loadOnce('gdelt')` calls to `loadOnce('global_incidents')`, update `layerFetchedRef` guard key, and update the `ensureSearchSources` array
- Why: ARCHITECTURE.md convention says LAYER_LOADERS key and `activeLayers` key should match. The current mismatch makes the code harder to follow and breaks any automated key-validation tooling. (Low urgency — the wiring is functionally correct today.)

---

## Verification Checklist

After applying P1 fixes, run:
```
1. npx tsc --noEmit                        # must pass clean
2. npx next dev -p 3002
3. curl localhost:3002/api/kab-threats     # must return JSON, Cache-Control: public, s-maxage=60
4. curl localhost:3002/api/air-raids       # verify 502 on vadimklimenko failure (use a network block to test)
5. Toggle GPS Jamming in LayerPanel        # must either show data or be absent from UI (not show nothing)
6. npm run build                           # exit 0 required before rebuilding :3001
```
