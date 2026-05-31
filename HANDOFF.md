# Handoff — osiris-Ukraine review follow-ups

Context: this branch was reviewed against TypeScript/Next.js best practices. The
original review-cleanup commit is recorded first; the follow-up items raised after
it were worked in a later session and are now mostly **resolved** — see status tags.

---

## Done in the review-cleanup commit (70e2862)

- **Line endings:** `maritime` + `flights` had drifted to CRLF, inflating diffs and
  polluting blame. Normalized to LF and added `.gitattributes` (`* text=auto eol=lf`).
- **Typed the `any`s** in `flights` (added `AdsbAircraft`, `Ship`, `ClassifiedFlight`,
  `JammingPoint`, `FlightResponse`) and `maritime` — both now lint-clean.
- **`bomb_risk` correctness:** removed the `RA-` registration match (RA- is the
  *civilian* Russian registry, not military), dropped the over-broad `RU` callsign
  prefix, and named the altitude window constants (`KAB_RELEASE_FLOOR_FT`/`CEIL_FT`).
- **Dynamic shadow-fleet watchlist:** `src/lib/shadowFleet.ts` replaces the 32
  hardcoded IMOs. Pulls from OFAC SDN (keyless), 12h TTL, background refresh,
  seed-union fallback. Verified: ~1,937 IMOs live + curated seed.
- **Coord-order comments** added to `gdelt` `GEO_DICT` (`[lng,lat]`) and `news`
  `KEYWORD_COORDS` (`[lat,lng]`) — opposite conventions, easy to invert.

---

## Resolved in the follow-up session (eda5ca8, b4eb139, ac012f3)

### 1. ✅ DONE — synthetic "ghost ship" injection removed
`fetchVesselApiFallback()` (which fabricated 75–110 random `V-SAT`/`S-AIS` vessels
tuned to trip CRITICAL congestion/chokepoint thresholds and served them as live AIS)
is **deleted entirely**, along with its `GET()` call. Port/chokepoint stats now
reflect only real vessels. Commit `eda5ca8`.

### 2. ✅ DONE — KAB threat re-wired to Telegram OSINT (not the air-raid feed)
**The original plan's premise was wrong** and is corrected here: `/api/air-raids` is
wired to `vadimklimenko.com/map/statuses.json`, which is **binary on/off per
oblast/raion with no threat type** — NOT `alerts.com.ua`. And `alerts.in.ua`
(token-gated) has **no KAB category** either (only `air_raid`/`artillery`/`chemical`/
`nuclear`). KAB warnings exist only as free text in UA OSINT Telegram channels.

Built `/api/kab-threats` (commit `ac012f3`): scrapes UA threat channels, regex-detects
KAB/UMPK/glide-bomb mentions across UK/RU/EN with Unicode-aware word boundaries
(unit-tested to reject `кабінет`/`кабель`/`Kabul`/`кабани`), attributes each to an
oblast by keyword, 3h window, one aggregated marker per oblast (count + latest text +
sources). 60s cache + coalescing. Wired as a deep-orange `kab_threats` map layer
mirroring the air-raid pattern (LayerPanel toggle, glow/dots/label, click popup with a
"heuristic — verify before acting" caveat).

- **Note:** the ADS-B `bomb_risk` flag in `flights/route.ts` was **dead data** — no
  component ever consumed it. It is left in place as a documented *supplementary*
  overlay; consider removing it if it stays unused. The Telegram layer is now the
  primary KAB signal.

### 4. ✅ DONE — shadow-fleet flag was being dropped (real bug, fixed)
Root cause was not the watchlist but a **drop bug**: AIS carries IMO only in the
infrequent `ShipStaticData` message; the `if (existing.lat && existing.lng)` store
guard discarded that whole update (flag included) when it arrived before the first
position fix. Fix (commit `eda5ca8`): a sticky global `shadowMmsi: Set<number>` records
matched MMSIs, and the flag is re-attached on every update — surviving message ordering
and persisting across the ship's lifetime.

**Follow-up (commit `02f0e04`) — the real recall lever was MMSI matching.** The sticky
fix alone could not raise the count, because IMO is only broadcast in the infrequent
`ShipStaticData` message — a vessel could be flagged only if it sent a matching static
message in-window, which dark-fleet tankers often don't. The OFAC SDN source also
carries **MMSIs** (761 unique, `MMSI 123456789`), and MMSI rides on **every** position
report. `shadowFleet.ts` now parses + exposes `getShadowFleetMmsis()`, and the maritime
handler flags a vessel the instant a sanctioned MMSI appears in any message. IMO match
stays as the complementary path. This is the change that should actually raise the
on-map count (still bounded by which sanctioned vessels are in the AIS bounding boxes
and not AIS-dark).

> ⚠️ **Deployment note:** the live app is served by a separate `next-server` process
> (different user) from its own checkout — pushing to `origin/osiris-Ukraine` does NOT
> update it. To see #4 (or any fix here), that deployment must `git pull` + rebuild
> (`next build`) + restart, and the browser must hard-refresh (the `.geojson` and API
> responses are cached).

### 6. ✅ DONE — React #418 hydration warning hardened
Audited every first-paint render path (clocks, `localStorage`/`window` reads,
render-time `toLocaleTimeString()`, layout, splash) — all correctly deferred/gated, so
app code is clean; the realistic cause is a browser extension mutating the DOM pre-
hydration. Added `suppressHydrationWarning` to `<body>` and removed SharePanel's
server/client `window` branch (which also carried a stale wrong fallback origin).
Commit `eda5ca8`. To confirm an extension is the source: Incognito + extensions-off
hard reload; if it vanishes, ignore.

---

## Still open

### 3. ⚠️ PARTIAL — lint / CRLF hygiene
- **CRLF: ✅ DONE.** All 27 remaining CRLF files renormalized to LF; the index is now
  100% LF (commit `b4eb139`).
- **The 6 RSS-parsing `any`s: ✅ DONE** — typed via `ParsedArticle` (news) and
  `ConflictEvent` (gdelt).
- **⚠️ BUT the lint debt is far bigger than first thought:** full-repo eslint is
  **~304 errors / 40 warnings**, not 6 — overwhelmingly `@typescript-eslint/no-explicit-any`
  spread across many components and `src/lib/sdk/PolybolosClient.ts` (none touched by
  this branch). `OsirisMap.tsx` alone has ~83. Fixing all of it is a large, separate
  effort; **do not enforce eslint in the build until it's cleared** or the build will
  break. New code added this session (`kab-threats/route.ts`) is lint-clean; the `any`s
  added in `OsirisMap.tsx` deliberately match the file's existing style.

### 5. ✅ DONE — red oblast/rayon fills rendered with spikes & black holes
**Root cause (from the screenshots): corrupted polygon geometry, not the alert→region
matching.** The red dots sat on the correct rayons, but the fills showed triangular red
spikes shooting across the map and black inverted triangles inside the fills. Geometry
audit of `public/ukraine-districts.geojson` found the smoking gun: rings containing
spurious **long connecting chords** (e.g. Bakhmut had a single ~23 km segment from
`37.97`→`38.28` at constant latitude while every neighbor stepped ~0.01°). That is the
signature of a **MultiPolygon flattened into a single Polygon ring** — the connecting
chords self-intersect, and MapLibre's earcut tessellation renders the crossings as
spikes + black (inverted-winding) triangles. 76/155 districts were self-intersecting,
and winding was mixed (non-RFC-7946).

**Fix (commit below):** re-processed both `public/ukraine-oblasts.geojson` and
`public/ukraine-districts.geojson` with `mapshaper -clean`, which dissolved the slivers,
restored proper **MultiPolygons** (80 districts / 21 oblasts re-exploded), and made
winding uniformly CCW. Verified afterwards: **0 self-intersecting rings**, names
(`name_en`/`name_ua`) preserved so the existing filters keep matching, frontline rayons
retain full area (Bakhmut/Pokrovsk/Kramatorsk/Mariupol ratios 1.00–1.05). `-clean`
dropped 3 features — all **Crimea urban okrugs** (Dzhankoi, Yany Kapu, Simferopol) that
are not in the air-raid feed mapping, so no live alert region was lost.

- **Reproduce the regeneration if the assets are ever re-sourced:**
  `mapshaper <in>.geojson -clean -o <out>.geojson` (mapshaper 0.7.x). Always re-audit for
  self-intersections + CCW winding afterward.
- **Note:** the other suspects (name-matching, filter wiring) were *not* the problem and
  were left as-is.

### 7. 🔧 TODO — set up the recon (active-scan) tools
The OsintPanel recon tools split into two tiers:
- **Keyless & working now:** DNS, WHOIS, BGP/ASN, SSL certs, Shodan **InternetDB**,
  IP geo, CVE, threats, MAC, phone, leaks, GitHub, sanctions — all hit public keyless
  endpoints (no env vars in `src/app/api/osint/*`).
- **Not configured / non-functional:** the active **port-scan / Nmap sweep**
  (`/api/scanner`) returns `503 "Scanner not configured"` until `SCANNER_URL` +
  `SCANNER_KEY` point at a real scanner backend. Set both in `.env`.
  - **Touch points:** `src/app/api/scanner/route.ts:9-10,41-42`,
    `src/app/api/osint/sweep/route.ts`, `src/components/OsintPanel.tsx` (sweep UI).
- **Optional richer recon:** a real **`SHODAN_API_KEY`** — today only the free keyless
  `internetdb.shodan.io` is used (`src/app/api/osint/shodan/route.ts:12`), which has no
  host search and no exposed-service/RTSP discovery. A full key unlocks host search and
  directly feeds #9 (camera discovery).
- **⚠️ Authorization caveat:** active scanning must target only assets you are
  authorized to scan. Gate the scanner backend (allow-list / auth) before exposing it;
  do not ship an open relay.

### 8. 🔧 TODO — more OSINT coverage on Russia
Russia currently appears only incidentally: news/gdelt keyword hits, maritime Russian
ports + Black Sea Fleet, and `isRussianMilitary()` in flights. Add dedicated RU OSINT:
- **Sources:** RU milblogger / regional-emergency Telegram channels (only `rybar` is in
  the news list today — extend `TELEGRAM_CHANNELS`), RU rail/logistics and airfield
  activity, thermal anomalies over RU military sites (NASA FIRMS is already wired in
  `fires/route.ts` — add RU areas of interest).
- **Geo precision:** the news `KEYWORD_COORDS` and gdelt `GEO_DICT` only carry RU border
  oblasts (Belgorod/Kursk/Bryansk/Voronezh/Rostov) — extend to interior oblasts/cities
  for finer placement.
- **Touch points:** `src/app/api/news/route.ts` (`TELEGRAM_CHANNELS`, `KEYWORD_COORDS`),
  `src/app/api/gdelt/route.ts` (`GEO_DICT`), `src/app/api/fires/route.ts` (AOIs), and
  possibly a dedicated `/api/russia-*` route if the signals warrant their own layer.

### 9. 🔧 TODO — Russia cameras
The CCTV layer (`/api/cctv`) covers only US / UK / Canada traffic cams (TfL, WSDOT,
Caltrans, 511 Ontario/Alberta, Ville MTL, …) — **zero RU/UA coverage**. Add Russian
public camera feeds:
- **Public RU traffic-cam portals:** many RU cities/regions publish open JSON/MJPEG
  camera feeds (regional traffic / ЦОДД portals). Add them as new source functions in
  `cctv/route.ts` mirroring the existing pattern — each emits
  `{ id, lat, lng, name, city, country, feed_url, source }` pushed into `allCams`. They
  render through the existing `cctv` map layer with no frontend changes.
- **Exposed-camera discovery (optional, depends on #7 Shodan key):** Shodan host search
  can surface RTSP/webcam banners by RU geo.
- **⚠️ Legal/ethical caveat:** index only cameras that are *intentionally public*
  (official traffic/city feeds). Do **not** access or expose private/credentialed
  cameras. Document the source provenance per feed.
- **Touch points:** `src/app/api/cctv/route.ts` (add RU source fns + merge into
  `allCams`); markers already render via the `cctv` layer in `OsirisMap.tsx`.

---

## Notes
- Shadow-fleet source is overridable via `SHADOW_FLEET_SOURCE_URL` (JSON array,
  `{imos:[...]}`, objects with `imo`/`imoNumber`, or any text containing `IMO 1234567`).
- `/api/air-raids` uses the keyless `vadimklimenko.com/map/statuses.json` feed (binary
  on/off per region, no threat type). `alerts.in.ua` would need a token and still has no
  KAB category — hence #2 went the Telegram-text route.
- `/api/kab-threats` knobs: `UA_THREAT_CHANNELS`, `KAB_PATTERNS`, `OBLAST_REFS`,
  `WINDOW_HOURS` (3), `CACHE_TTL_MS` (60s). Add oblasts/cities by extending `OBLAST_REFS`.
