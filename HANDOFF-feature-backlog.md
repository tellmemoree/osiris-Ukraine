# Osiris — Groomed Feature Backlog

Forward-looking feature candidates (distinct from the bug/review follow-ups in
[`HANDOFF.md`](./HANDOFF.md) and the recon/camera setup in
[`HANDOFF-recon-toolkit.md`](./HANDOFF-recon-toolkit.md)). Groomed 2026-06-03.

**Effort key:** S = ~1 session · M = a few sessions · L = multi-session/needs design.
**Branch workflow:** build on `osiris-Ukraine` (tinkering); `osiris-Ukraine-merged`
is kept in lockstep (fast-forward) and both are pushed. See HANDOFF.md.

> **Biggest single insight from grooming:** several backend routes are *built but
> dark* — they have working `/api/*` handlers but **zero frontend references**:
> `frontlines`, `air-quality`, `sentinel`, and the new `ip-intel`. Surfacing these
> is the highest payoff-per-effort work available.

---

## Direction 1 — Surface "dark" data (quick wins)

### 1.1 — Frontline overlay  ·  Effort: S–M  ·  ⭐ top pick
A conflict map with **no frontline** is the most glaring gap. `/api/frontlines`
exists and is unused by any component.
- **Build:** add a line/control-zone layer in `src/components/OsirisMap.tsx`; add a
  `frontlines` toggle under the **UKRAINE WAR** group in `LayerPanel.tsx`.
- **First step:** inspect the `/api/frontlines` response shape (GeoJSON? point list?)
  and pick the right MapLibre layer type (line vs fill).
- **Deps:** none. Data route already live.

### 1.2 — IP-intel map layer + Censys OsintPanel tab  ·  Effort: M
Finishes the recon-enrichment work just shipped (`/api/ip-intel`, commit `e18fd50`).
- **Build:** `ip_intel` map layer (`ip-intel-dots`) for geolocated lookups; a Censys
  result card/tab in `src/components/OsintPanel.tsx` (ASN, geo, services, certs).
- **Deps:** UI buildable now (route returns 503 until keys); paste `CENSYS_API_ID`/
  `CENSYS_API_SECRET` into `.env` to see live data (see HANDOFF-recon-toolkit.md).

### 1.3 — Air-quality layer  ·  Effort: S
`/api/air-quality` is built and dark. Add a layer under **NATURAL HAZARDS**
(AQI dots/heat). Useful as a secondary environmental signal (smoke from fires/strikes).

### 1.4 — Space-weather indicator  ·  Effort: S
`/api/space-weather` is only lightly referenced. Surface Kp index / aurora / solar
storm state as a HUD badge or a thin layer — also a plausible HF-comms / GPS-degradation
context signal alongside the existing GPS-jamming layer.

---

## Direction 2 — Conflict-intel depth (Ukraine / Russia)

### 2.1 — Frontline change tracker  ·  Effort: L
Snapshot `/api/frontlines` on a schedule, diff successive snapshots, and render
advances/withdrawals (movement arrows or a "since yesterday" delta).
- **Needs:** lightweight persistence for snapshots (flat JSON in `public/data/` or a
  small store) + a diff routine. Builds on 1.1.

### 2.2 — RU rail / logistics layer  ·  Effort: M–L
Russian military logistics ride the rail net. New `/api/ru-logistics` (rail nodes,
junctions, known depots).
- **Data sourcing (open):** OSM railways (Overpass — already used for UA admin
  boundaries) + curated depot/marshalling-yard coords. (Listed as a non-done
  follow-up under HANDOFF.md #8.)

### 2.3 — FIRMS thermal AOIs over RU airfields  ·  Effort: M
Cross-reference `/api/fires` (FIRMS) with known RU airbase coordinates already in the
news gazetteer (Engels, Morozovsk, Millerovo, Yeysk, Dyagilevo, Olenya, Saky/Dzhankoi —
see HANDOFF.md #8). A FIRMS hotspot within N km of a base ⇒ flag a possible
strike/incident and raise it in `LiveAlerts`.
- **Why:** turns the existing global FIRMS feed into targeted strike-detection with no
  new data source. Pairs naturally with the KAB-threat layer.

### 2.4 — Event timeline / playback  ·  Effort: L
A time-scrubber to replay the last 24–72h of air raids, KAB threats, strikes, and
geolocated news.
- **Needs:** a timestamped event store (most routes already carry timestamps) + a
  timeline control component + map state driven by the scrub position.

---

## Direction 3 — Recon / OSINT expansion (continues current thread)

### 3.1 — Camera expansion  ·  Effort: M
From HANDOFF-recon-toolkit.md Part 2:
- **Windy webcam API** — bbox fetcher in `src/app/api/cctv/route.ts` gated on
  `WINDY_WEBCAM_KEY` (free 500 req/day). RU bbox `41–82 / 19–190`.
- **insecam.org** — scrape RU/UA exposed-cam MJPEG URLs; add `stream_type: 'mjpeg'`
  support in the camera viewer (currently iframe/feed_url + the new Middle East
  `stream_type: 'iframe'`).
- **RU YouTube live channels** — add to `BUILTIN_FEEDS` in `LiveAlerts.tsx` with a
  `category: 'propaganda'` flag for state TV.
- **Deps:** Windy key; some RU portals need the proxy (3.2).

### 3.2 — ruFetch() proxy scaffold (#7b)  ·  Effort: S–M
Add a `ruFetch()` helper using `undici`'s `ProxyAgent`, gated on `RU_PROXY_URL`
(unset ⇒ direct fetch, nothing breaks). Wire into RU camera/portal fetchers so RU
geoblocks can be defeated once a residential RU proxy (IPRoyal selected) is purchased.
- **Deps:** proxy purchase to *activate*; scaffold lands without it.

### 3.3 — Scanner backend wiring (#7)  ·  Effort: ops
`/api/scanner` is built and hardened (SSRF guard, scan allow-list) but returns 503
until `SCANNER_URL`/`SCANNER_KEY` point at a real scanner service.
- **Deps:** stand the scanner up on the **separate prod machine** (keeps active-scan
  off the home server); also a paid Shodan membership for host-search/discovery.

---

## Direction 4 — AI & alerting

### 4.1 — Auto situation briefings  ·  Effort: M
Build on `/api/ai/briefing` + `/api/ai/analyze`: scheduled (e.g. hourly) digest
summarizing active air raids, KAB threats, notable strikes/news, and shadow-fleet
movements. Surface in a Briefing panel and/or push to Telegram.

### 4.2 — Threshold alerts  ·  Effort: M–L
A small rule engine that fires when conditions co-occur, e.g.:
- air raid **and** KAB threat in the same oblast,
- a shadow-fleet vessel enters a chokepoint,
- a FIRMS hotspot appears near an RU airfield (ties to 2.3).
- **Delivery:** in-app toast + optional webhook / Telegram.

### 4.3 — Entity watchlist  ·  Effort: M–L
Let the operator pin an entity (ship MMSI, airfield, unit) and track it over time —
a per-entity sighting timeline. Builds on the existing entity search/index.

---

## Suggested sequencing
1. **1.1 Frontline overlay** — biggest visible gap, no deps, builds the substrate 2.1
   needs.
2. **1.2 IP-intel layer + Censys tab** — closes the loop on what we just shipped.
3. **2.3 FIRMS-over-airfields** — high analytic value, reuses existing feeds + gazetteer.
4. Then pick a larger track (2.4 timeline, 4.x alerting) once the quick wins land.
