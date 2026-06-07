# Osiris — Groomed Feature Backlog

Forward-looking feature candidates (distinct from the bug/review follow-ups in
[`HANDOFF.md`](./HANDOFF.md) and the recon/camera setup in
[`HANDOFF-recon-toolkit.md`](./HANDOFF-recon-toolkit.md)). Groomed 2026-06-03.

**Effort key:** S = ~1 session · M = a few sessions · L = multi-session/needs design.
**Branch workflow:** build features on `osiris-Ukraine`; integrate into
`osiris-Ukraine-merged` (= Ukraine + master) by **merging, not fast-forward** — the
branches diverge on purpose. Master syncs go INTO `-merged`. See ARCHITECTURE.md → Branch & dev workflow.

> **Biggest single insight from grooming:** several backend routes are *built but
> dark* — they have working `/api/*` handlers but **zero frontend references**:
> `frontlines`, `air-quality`, `sentinel`, and the new `ip-intel`. Surfacing these
> is the highest payoff-per-effort work available.

> **Update (2026-06-03) — the dark routes were dark because they're BROKEN, not just
> un-wired.** `/api/frontlines` read `.features` but DeepState nests under `.map.features`
> (fixed — now live). `/api/air-quality`'s upstream OpenAQ v2 returns **HTTP 410 Gone**
> (deprecated). Verify a dark route actually returns data before building UI for it.

---

## Direction 1 — Surface "dark" data (quick wins)

### 1.1 — Frontline overlay  ·  ✅ DONE (2026-06-03)
A conflict map with **no frontline** is the most glaring gap. `/api/frontlines`
exists and is unused by any component.
- **Build:** add a line/control-zone layer in `src/components/OsirisMap.tsx`; add a
  `frontlines` toggle under the **UKRAINE WAR** group in `LayerPanel.tsx`.
- **Shipped:** fixed the route schema bug (`.map.features`), wired `frontlines` into
  `LAYER_LOADERS` + toggle-gated loading/polling, added a **Frontline (DeepState)**
  toggle under the UKRAINE WAR group, and render fill + line layers in `OsirisMap`
  using each feature's own DeepState colors (`['get','fill']`/`['get','stroke']`).
  Live: 522 features (119 occupied-zone polygons + 403 POI points; points not drawn).
- **Note:** Militaryland's geojson endpoint is now 404 — the route degrades gracefully
  to DeepState (the better source anyway).

### 1.2 — IP-intel map layer + Censys OsintPanel tab  ·  ✅ DONE (2026-06-03)
**Shipped:** added an **IP INTEL** tab to `OsintPanel` (TABS entry + URL case +
result renderer showing ASN, geo, open services, TLS certs). Results plot on the map
via the **existing `scan-targets` channel** (`onScanGeolocate`) — no separate
`ip-intel-dots` source needed, since Censys already returns lat/lng. Until
`CENSYS_API_ID`/`CENSYS_API_SECRET` are pasted into `.env`, the tab shows the route's
503 "Censys not configured" message; with keys it renders full enrichment + a map dot.
- **Verified:** route reachable (503 no-key), page compiles, tsc clean.

### 1.3 — Air-quality layer  ·  ✅ DONE (2026-06-03)
**Shipped** (keyless): the dead OpenAQ v2 (HTTP 410) was replaced with the **Open-Meteo
Air Quality API** — no key. Since Open-Meteo is point-based, the route batches a curated
42-city list (global majors + UA/RU emphasis) into one multi-coordinate request and maps
each point's `current` PM2.5/US-AQI to a station marker (same shape as before). Added an
**Air Quality (PM2.5)** toggle under NATURAL HAZARDS and colored AQI dots (glow + dot +
label) in `OsirisMap`. 1h cache; verified 42 stations live, tsc clean.
- **Extend later:** add more cities, or switch to a bbox/viewport query if you want
  denser coverage than the curated list.

### 1.4 — Space-weather indicator  ·  ✅ DONE (2026-06-05)
**Shipped:** added a compact `SOLAR Kp{X}` HUD badge to the mobile top-right status bar
(next to the SUPPORT PROJECT button) in `page.tsx`. Badge border/background tints to the
storm color; a pulsing dot appears at Kp ≥ 4 (G1+). Desktop already showed the Kp badge
(`hidden lg:inline`). Mobile now has parity. Data from `/api/space-weather` (NOAA SWPC,
keyless, already fetched on load).

---

## Direction 2 — Conflict-intel depth (Ukraine / Russia)

### 2.1 — Frontline change tracker  ·  ✅ DONE (2026-06-06)
**Shipped:** `/api/frontline-changes` snapshots DeepState polygon areas once per UTC
day to `~/.osiris-data/frontline-history.json` (persists across rebuilds, capped at
120 days). Returns `delta_1d`/`delta_7d` (growth = RU expansion, in km²). Deltas are
`null` until a second UTC day is recorded — after that they fill automatically.
`src/components/FrontlineTracker.tsx` — a glass card bottom-right on desktop and
inline in the mobile layers drawer — polls hourly and renders the current footprint,
24h delta, and 7d delta with red/green trend arrows. Gated on `activeLayers.frontlines`
(appears automatically when the Frontline layer is toggled on).
**Live:** 299,887 km² footprint, +6 km² over 7d as of first data (2026-06-03).

### 2.2 — RU rail / logistics layer  ·  ✅ DONE (folded into 2.3, 2026-06-03)
**Shipped as part of the Thermal Strike AOIs layer (2.3):** rail hubs / marshalling
yards (Rostov, Bataysk, Likhaya, Voronezh, Bryansk, Tikhoretsk, Dzhankoi, Armyansk)
and occupied logistics nodes (Melitopol, Tokmak, Volnovakha, Mariupol, Belgorod) are
curated sites in `/api/strategic-thermal`, monitored for nearby FIRMS hits alongside
airfields. A standalone OSM-railway *network* overlay was NOT built (curated nodes
cover the strike-relevant hubs); revisit if you want full rail-line geometry.

### 2.3 — Thermal Strike AOIs (FIRMS × sites/rail/news)  ·  ✅ DONE (2026-06-03)
**Shipped** as a dedicated **`thermal_aoi`** layer (toggle "Thermal Strike AOIs" under
UKRAINE WAR). New route **`/api/strategic-thermal`** fetches FIRMS theater fires (bbox
lat 43–71 / lng 19–66, keyless 24h CSV) and cross-references them against THREE POI
types within range (12 km sites / 15 km news):
- **Airfields** (Engels, Dyagilevo, Morozovsk, Millerovo, Yeysk, Olenya, Saky, Belbek…),
- **Rail/logistics** hubs (2.2 — see above),
- **Oil depots / refineries** (Novorossiysk, Tuapse, Ryazan, Volgograd, Afipsky, Syzran…),
- **News-named locations** — pulled by internally fetching `/api/news`
  (`new URL('/api/news', req.url)`) and matching geolocated items to nearby fires.
Sites are always shown (dim when no fire, glow + label on a hit); news entries appear
only when a fire corroborates them. Map dots are colored by category with a click
popup (fire count, max FRP, latest detection, news source/link) and a "heuristic —
verify" caveat. Verified live: 26 sites, 373 theater fires, hits on Belgorod + 3 news
locations. **Not done:** raising hits into `LiveAlerts` (map-only for now).

**Refined (2026-06-03):** added oil depots/refineries (40 sites total). News matching
hardened against false positives — only **strike-related** articles count (multilingual
STRIKE_TERMS filter), and every place an article names is checked (news route now exposes
`places[]` via `findAllCoords`, not just the single primary match). Each hit carries an
FRP-based **confidence** (low/med/high); low-confidence hits render without a glow to
de-emphasize likely false positives. **Still not done:** raising hits into `LiveAlerts`.

### 2.3b — Strike / advance classifier refinement  ·  Effort: S
Thermal AOI and Captures layers are **hidden from the panel** (2026-06-05) pending
classifier tuning. Too many false positives from `STRIKE_TERMS` / `ADVANCE_TERMS` /
`isTerritorialAdvance()`. User will hand-pick example articles (both strike and
capture/advance) to align on what counts as each.

- **Touch points:**
  - `src/app/api/strategic-thermal/route.ts` — `STRIKE_TERMS`, `ADVANCE_TERMS`,
    `isStrikeRelated()`, `isTerritorialAdvance()`
  - `src/app/api/captures/route.ts` — capture-detection logic (TBD)
  - `src/components/LayerPanel.tsx` — re-add the two commented-out entries when ready
- **To restore:** un-comment the two lines in `LAYER_GROUPS` (UA WAR section) in
  `LayerPanel.tsx`; routes and map rendering are fully intact.

### 2.4 — Event timeline / playback  ·  ✅ DONE (2026-06-06)
**Shipped:** `src/components/TimelineControl.tsx` — a bottom-of-map scrubber bar (desktop
only) toggled via the Play button in the right tool strip.
- **Play/pause** with 1×/4×/12× speed; **range selector** 6h/12h/24h/48h; **LIVE** button.
- **Density histogram** behind the scrubber bucketed by event type (cyan = news/intel,
  orange = KAB threat, yellow = global incidents).
- **Drag or click** anywhere on the track to jump to a time.
- **Map filtering:** when scrubbing, `news_intel`, `kab_threats`, and `global_incidents`
  layers filter to show only events ≤ scrub position (within the selected range window).
  All three `useEffect`s in `OsirisMap.tsx` are replay-aware via the `replayTime` prop.
- **Out of scope (Phase 2):** air-raid history (binary on/off, no per-event timestamps —
  needs a background poller snapshotting state to `~/.osiris-data/`); thermal AOI (layer
  still hidden pending 2.3b classifier tuning).

---

## Direction 3 — Recon / OSINT expansion (continues current thread)

### 3.1 — Camera expansion  ·  ✅ DONE (2026-06-05), RU portion scrapped (2026-06-06)
**Shipped (Ukraine):**
- **`stream_type: 'mjpeg'`** added to `CctvStreamType` (`types.ts`) and rendered
  as a native `<img src={stream_url}>` in `CameraViewer.tsx`.
- **Windy webcam bbox fetcher** (`fetchWindyCameras()`) in `cctv/route.ts`, gated on
  `WINDY_WEBCAM_KEY` (free, 500 req/day). UA bbox 44–53/21.5–41 wired into
  `fetchUkraineCameras()`.

**RU expansion scrapped (2026-06-06):** MJPEG streams from RU devices are geoblocked
at the browser level — a server-side relay would be needed, making the proxy cost
prohibitive (GB-scale per session). All RU-specific code removed: `fetchRussiaCameras()`,
`parseInsecamHtml()`, `RU_CITY_COORDS`, `ru-fetch.ts`, `undici` dep, `RU_PROXY_URL` env.

### 3.2 — ruFetch() proxy scaffold  ·  🗑 REMOVED (2026-06-06)
Scrapped along with the RU camera expansion. `src/lib/ru-fetch.ts` deleted.

### 3.3 — Scanner backend wiring (#7)  ·  ✅ DONE (2026-06-05)
**Shipped:** route fully rewritten — all scan types run inline with Shodan augmentation.

**⚠️ Superseded by 3.4:** active scan types (traceroute, port scan, SSL, headers, tech
live-fetch, vuln/Nuclei) must move to an external scanner node for OPSEC — inline
connections trace back to the Osiris server IP.

### 3.4 — External scanner node  ·  Effort: M  ·  📄 [`HANDOFF-scanner-node.md`](./HANDOFF-scanner-node.md)
Active probing tools need a separate VPS on a different provider/region. Full spec,
infrastructure checklist, and Osiris-side changes are in `HANDOFF-scanner-node.md`.

**Summary:**
- Provision Hetzner/Vultr VPS (Ubuntu 22.04, 2 GB RAM)
- Install mtr + Nuclei on the node
- Write a small Fastify microservice that proxies scan requests
- Restore `SCANNER_URL`/`SCANNER_KEY` env vars in Osiris
- Active types proxy to node; passive types (subdomains/rdns/whois/geoloc) stay inline
- `vuln` gets Nuclei on the node + NVD passive cross-reference as inline fallback

---

## Direction 4 — AI & alerting

### 4.1 — Auto situation briefings  ·  ✅ DONE (2026-06-07)
**Shipped:** intel digest with scheduled summaries of active air raids, KAB threats,
notable strikes/news, and shadow-fleet movements. Pushed to Telegram.

### 4.2 — Threshold alerts  ·  ✅ DONE (2026-06-07)
**Shipped:** rule engine fires when conditions co-occur (air raid + KAB threat in same
oblast; FIRMS hotspot near RU airfield). Delivery: Telegram push.

### 4.3 — Entity watchlist  ·  🗑 REMOVED
Scrapped — scope not worth the complexity for current use case.

---

## Direction 5 — Groomed 2026-06-07 (osint-idea-groomer)

### 5.1 — Oblast Pressure Index  ·  Effort: M
Fuse air-raid frequency, KAB threat count, frontline proximity, and power-outage status into a per-oblast weighted score; render as a choropleth. All four feeds live — the join is missing. Needs UA oblast boundary GeoJSON asset + name-normalization table.

### 5.2 — Air Raid History Playback  ·  Effort: S–M
Background poller snapshots air-raid state every 5 min → `~/.osiris-data/air-raid-history.json`. Closes the explicit 2.4 Phase 2 gap. Extends timeline scrubber with a fourth histogram bucket. Same pattern as `frontline-history.json`.

### 5.3 — ACLED Conflict Event Layer  ·  Effort: M
Structured, actor-coded conflict events (battles, explosions, civilian targeting) as a toggleable layer. 24–48h lag. Requires free API key at acleddata.com (human step). Attribution required in popup.

### 5.4 — Drone / UAV Incident Tracker  ·  Effort: S
Extract Shahed/UAV swarm events from existing news feed via `DRONE_TERMS` filter (Cyrillic + Latin). Zero new infrastructure. Main work is term vocabulary + exclusion list to avoid false positives.

### 5.5 — Shadow Fleet Movement Corridors  ·  Effort: M
Persist AIS position history for shadow-fleet MMSIs → track polylines (dashed faint lines). Shows loitering vs. transit vs. rendezvous. Key risk: careful modification of the AIS WebSocket handler.

### 5.6 — Axis Briefing  ·  ✅ DONE (2026-06-07)
**Shipped:** `/api/axis-briefing/route.ts` + `src/components/AxisBriefing.tsx` + toolbar button (Crosshair icon). 8 named operational axes (Kharkiv → Kherson), each showing occupied area km² (DeepState polygon sum within bbox), up to 5 recent news headlines (from `/api/news` places[] filtering), and an optional one-sentence Gemini summary per axis when `GEMINI_API_KEY_N` is set. 30-min cache; `?force=1` busts it. tsc clean. Key bug fixed during build: DeepState uses 3D coords `[lng, lat, 0]` — centroid collector needed `arr.length >= 2` not `=== 2`.

### 5.8 — Weapon-Type Enrichment for Air Raid Alerts  ·  Effort: S–M

Extend the existing Telegram-scraping infrastructure (currently kab-threats only) to classify **all major Russian weapon types** targeting Ukrainian oblasts and surface them as per-oblast weapon tags on the air-raid layer.

**Why it matters:** The air-raid layer (`/api/air-raids`) currently shows a binary alarm state with no threat context. The kab-threats route already detects KABs from `@war_monitor` and `@kpszsu` — those same channels report Kalibr, Kh-101, Shahed/Geran swarms, Iskander, Kinzhal, and S-300 surface-to-surface use. One pass over the same scraped messages can classify all of them.

**Sources already scraped (in `UA_THREAT_CHANNELS` in kab-threats route):**
- `@war_monitor` — reports inbound weapon types per region in near-real-time
- `@kpszsu` — Air Force of Ukraine official channel; structured weapon-type announcements
- `@GeneralStaffUA`, `@DeepStateUA`, `@UkraineWarReport`, `@ukraine_now`, `@ua_forces`, `@Militaryland`

**Additional sources to add for weapon coverage:**
- `@PovitryanaT` (Повітряні Сили ЗСУ) — UA Air Force, posts weapon-type breakdowns during attacks
- `@operativnoZSU` — operational updates with threat characterization
- `@khortytsia_ua` — Joint Forces command, detailed strike reports

**Weapon taxonomy to detect (Cyrillic + Latin, with declensions):**

| Weapon class | Key terms to match |
|---|---|
| KAB / glide bomb | Already in `KAB_PATTERNS` |
| Cruise missile (Kalibr / Kh-101 / Kh-555) | калібр, x-101, х-101, kh-101, крилата ракета |
| Ballistic (Iskander-M / -K) | іскандер, iskander, балістич |
| Shahed / Geran drone | шахед, shahed, герань, geran, бпла, дрон-камікадзе |
| Kinzhal hypersonic | кинджал, kinzhal, гіперзвук |
| S-300 / S-400 surface-to-surface | с-300, с-400 (surface mode), зенітна ракета по наземн |
| Kh-22 / Kh-32 anti-ship adapted | х-22, кh-22, х-32 |

**Implementation sketch:**
- Refactor `/api/kab-threats` → `/api/weapon-threats`: same Telegram scraping infrastructure, but match all weapon patterns per message and return `weaponType` (enum) instead of hardcoded `'KAB'`
- Each threat item carries `weaponType`, `count`, `startedAt`, `sources`, `snippet`; one item per (oblast × weaponType) combination
- `/api/air-raids` response stays unchanged — frontend fetches both and joins on oblast name to show weapon badges
- Air-raid map popup (or hover tooltip) shows active alarm + weapon type chips: `[KAB] [SHAHED x3] [KALIBR]`
- Alternatively, color-code alarm dots by most dangerous active threat (ballistic > cruise > KAB > drone)

**Touch points:**
- `src/app/api/kab-threats/route.ts` — rename + expand `WEAPON_PATTERNS`, change `alertType` to `weaponType`, update `KabThreat` type
- `src/components/OsirisMap.tsx` — join weapon-threats onto air-raid markers for popup enrichment
- `src/app/api/air-raids/route.ts` — `alertType` field currently hardcoded `'AIR'`; can stay as alarm state; weapon enrichment comes from the separate endpoint

**Keeps backward compat:** the kab-threats endpoint is consumed by the KAB layer toggle — rename the route or keep the old path as an alias returning `weaponType === 'KAB'` items only.

---

### 5.7 — Russian Oblast Air Raid Alerts  ·  Effort: S–M

Track Ukrainian drone/missile strikes triggering alerts in Russian border oblasts (Belgorod, Kursk, Bryansk, Voronezh, Rostov-on-Don, Krasnodar Krai, etc.) and surface them as a toggleable layer mirroring the existing UA air-raid feed.

**Why it matters:** completes the situational picture — OSIRIS currently shows only Ukrainian alarms. Russian border oblast alerts are a leading indicator of UA cross-border operations, and comparing alarm density on both sides reveals operational patterns.

**Data sources (no official API exists for RU territory — Telegram scraping required):**
- `@bazabazon` (Baza) — Russian breaking news, reports drone incursions promptly
- `@mashnews` (Mash) — breaking news aggregator, high-volume, reports RU oblast alerts
- `@shot_shot` (Shot) — Russian news, focuses on Belgorod/Kursk/Bryansk activity
- Regional channels: `@Molyar_Belgorod`, `@kursk_today`, `@voronezh_online` — oblast-specific alert posts, faster than national aggregators

**Implementation sketch:**
- New `/api/ru-air-raids` route; scrapes the above channels via `t.me/s/<channel>` (same pattern as `/api/news`); extracts oblast names from message text using a regex vocabulary (oblast names in Cyrillic + "дрон", "тревога", "БПЛА", "атака")
- Returns `{ oblast, started_at, source, raw }[]` — no official on/off state, so each item is a discrete event not a toggle
- Layer toggle under a new **RUSSIA** group in `LayerPanel.tsx`; renders as pulsing dot on RU oblast centroids (GeoJSON asset needed — RU oblast boundaries or just centroid coordinates for the ~10 border oblasts)
- No history needed initially; show events from last 24h only

**Gap vs. UA alarms:** UA side has a clean state API (`vadimklimenko`) with boolean on/off. RU side is event-based (no government alarm API) — surface as an event feed, not alarm state.

**Weapon tracking for RU oblasts (same as 5.8, mirrored):**
Ukrainian cross-border operations use a different weapon vocabulary: `Neptune`, `Storm Shadow / SCALP`, `ATACMS`, `HIMARS`, `дрон`, `БпЛА`, `безпілотник`. The same Telegram scraping pattern applies — extract weapon type from messages mentioning Russian oblast names + inbound weapon terms. Return one event per (RU oblast × weapon type) combination, surface as badges on the RU alert dots. Sources: `@bazabazon`, `@mashnews`, `@shot_shot` already list weapon types in their alerts.

**Key risk:** `t.me/s/` scrape reliability for high-volume channels; may need to rate-limit or cache aggressively (15-min TTL suggested). Mash and Baza post hundreds of items/day — need tight keyword filtering to avoid noise.

### 5.9 — OSINT Agent: AI News Enrichment  ·  Effort: S

Enrich the existing SIGINT feed with real AI-generated analysis instead of the current hardcoded placeholder. No new panels, no new toasts — all improvements surface inside the existing `IntelFeed` item card.

**What the agent does:**
- After building `newsItems` in `/api/news`, batch the top 15 items (risk_score ≥ 5) into a **single Gemini call** per 5-min cache period
- Per item the model returns: `assessment` (1–2 sentence tactical summary), `event_type` (strike/airstrike/advance/retreat/naval/cyber/logistics/diplomatic/null), `weapons` (string[] of weapon types named in the text)
- Replaces the hardcoded `machine_assessment` placeholder with the real AI text; adds `event_type` and `weapons` as new fields on each enriched item
- Un-enriched items (risk < 5 or Gemini unconfigured) get `machine_assessment: null` — no fake assessment

**UI additions (IntelFeed.tsx only):**
- `event_type` badge rendered in the item's top row (colored per type: strike=red, advance=blue, naval=cyan, cyber=purple, etc.)
- `weapons` chips rendered below the title (orange tint)
- `machine_assessment` block already exists and renders real text automatically once the route returns it

**Server-side caching (new):**
- Module-level 5-min cache on the news route (currently none — every request re-scrapes 30 Telegram channels)
- `export const dynamic = 'force-dynamic'` required for module-level vars
- Adds `Cache-Control: no-store` on the response (TTL is server-side, not CDN)

**Touch points:**
- `src/app/api/news/route.ts` — add cache + `batchEnrich()` using `@google/generative-ai` (already installed); `getGeminiKey()` same pattern as digest route; graceful fallback if Gemini fails or is unconfigured
- `src/components/IntelFeed.tsx` — update `NewsItem` type + render `event_type` badge + `weapons` chips

**Graceful degradation:** works with no Gemini key (just no enrichment fields); Gemini parse errors silently return empty Map (items stay unenriched, never crash).

---

## Suggested sequencing
1. **1.1 Frontline overlay** — biggest visible gap, no deps, builds the substrate 2.1
   needs.
2. **1.2 IP-intel layer + Censys tab** — closes the loop on what we just shipped.
3. **2.3 FIRMS-over-airfields** — high analytic value, reuses existing feeds + gazetteer.
4. Then pick a larger track (2.4 timeline, 4.x alerting) once the quick wins land.
