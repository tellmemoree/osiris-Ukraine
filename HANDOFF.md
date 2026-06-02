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

### 10. 🧹 TODO — repo-root cleanup after the UI-overhaul merge
The `osiris-Ukraine` ↔ `master` merge (commit `7082bc9`, "integrate UI overhaul")
pulled in a pile of **loose helper scripts / throwaway files from master** that were
never cleaned up. Left in place for now (deliberately, to avoid widening that merge) —
**look into pruning later.**
- **Obvious throwaways at repo root:** `diff.txt`, `temp_routes.txt`, `patch.js`,
  `patch2.js`, `patch3.js`, `patch_layer.js`, `recover.js`, `make_pdf.js`,
  `fix_netdata.py`, `fix_umami.py`.
- **`scripts/` one-offs from the overhaul:** `disable_sdk_links.js`, `extract_v51.js`,
  `generate_cables.js`, `patch_cables.js`, `patch_map_cables.js`, `patch_page.js`,
  `restore_telegeography_cables.js`, `sdk_ingester.js`, `upgrade_v5.js`,
  `upgrade_v5_1.js`. Some (e.g. the cable-generation scripts) may be worth keeping as
  regeneration tooling for `public/data/submarine-cables*.json` — **triage before deleting**:
  confirm each is a spent one-off vs. a reusable generator.
- **These are master's, not ours** — so when the fork's `master` is re-synced with the
  original upstream, decide whether they belong upstream or should be dropped from the fork.

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
- **Shodan key — SET, but free tier (⚠️ important):** a `SHODAN_API_KEY` is now stored in
  the **gitignored `.env`** (never commit it). `src/app/api/osint/shodan/route.ts` uses it
  for `/shodan/host/{ip}` (richer per-host data: geo, ISP, org, service banners) with a
  keyless `internetdb.shodan.io` fallback. **The current key is the free `oss` membership
  (`unlocked:false`, 0 query credits) — `/shodan/host/search` returns "Requires membership
  or higher", so host search / exposed-camera discovery does NOT work.** To enable
  discovery (#9 exposed cams), buy a Shodan **membership** (one-time ~$49 unlocks search +
  query credits); the code path is already documented in `docs/CAMERA_SOURCES.md` and needs
  no further changes once the key is upgraded.
- **⚠️ Authorization caveat:** active scanning must target only assets you are
  authorized to scan. Gate the scanner backend (allow-list / auth) before exposing it;
  do not ship an open relay.

### 7b. 🌐 Proxies — defeating the geoblock (RU/UA WAN)
RU regional cam portals (`is74.ru`, `webcamera.ru`, ЦОДД) and much of the RU WAN are
**geo-fenced** — they return `000`/`403` from this host and from Vercel. Same risk in
reverse for some UA sources. To reach them you need an **egress IP inside the target
country**.
- **Pattern (documented in `docs/CAMERA_SOURCES.md`):** set `RU_PROXY_URL` in `.env` and
  route fetchers through `undici`'s `ProxyAgent` via a small `ruFetch()` helper. Unset →
  direct fetch, so nothing breaks before the proxy exists.
- Prefer a **residential/mobile** RU proxy — datacenter RU ranges are themselves often
  blocked by the portals. The same proxy unblocks RU Telegram mirrors and (once Shodan is
  upgraded) RU-geo camera search.
- **Not yet wired into code** — the camera fetchers currently return curated directory
  links and don't fetch, so add `ruFetch()` when you implement a real RU portal scraper.

### 8. ✅ DONE — more OSINT coverage on Russia (commit `e431f67`)
- **RU Telegram channels:** added 9 milblogger/MoD channels (`milinfolive`, `wargonzo`,
  `epoddubny`, `sashakots`, `dva_majora`, `voenkorKotenok`, `rvvoenkor`, `grey_zone`,
  `mod_russia`), all verified scrapeable via `t.me/s/`. Dropped `rybar` from the scrape
  list (its `/s/` preview is disabled) but kept as a source link. ~72 RU items live.
- **Side tagging + RU tab:** every `/api/news` item now carries `side = ua | ru | world`
  (by source channel); `LiveAlerts.tsx` gained a separate **🇷🇺 RU MILBLOG** tab + count
  badge alongside UA.
- **Cyrillic geo:** added a bilingual gazetteer (RU cities, border oblasts, bomber/strike
  airfields — Engels, Morozovsk, Millerovo, Yeysk, Dyagilevo, Olenya, Saky/Dzhankoi — plus
  UA/RU spellings of frontline cities) to news `KEYWORD_COORDS`, and Latin RU interior
  cities/airfields to gdelt `GEO_DICT`. `findCoords` now tolerates Russian/Ukrainian case
  suffixes for Cyrillic keys (Покровск→под Покровском) while keeping Latin strict
  (Iranian≠Iran); guarded Белоруссия≠Россия. RU geo recall ~15→27 of 72 live.
- **Still open (smaller follow-ups):** RU rail/logistics + FIRMS thermal AOIs over RU
  military sites were *not* done (FIRMS already loads a global feed, so RU fires appear
  already; a dedicated AOI overlay is optional). No separate `/api/russia-*` layer added —
  the signals ride the existing news/gdelt layers.

### 9. ✅ DONE (public feeds) — Russia/Ukraine cameras (commit below)
Added `fetchRussiaCameras()` + `fetchUkraineCameras()` to `cctv/route.ts`, registered as
`russia`/`ukraine` regions and wired into `getRegionsForBounds` (RU: lat 41–78/lng 19–180;
UA: lat 44–53/lng 21.5–41). 12 pins total (7 RU + 5 UA).
- **Why curated, not scraped:** there is **no keyless public RU/UA traffic-cam JSON API
  that resolves reliably** — regional portals (`is74.ru`, `webcamera.ru`, RU ЦОДД) return
  `000`/auth-gated from non-RU IPs, and `skylinewebcams` country pages aren't cleanly
  scrapeable into coords. Rather than ship a fetcher that returns empty in prod (the
  ghost-ship anti-pattern), pins point to **verified-200 intentionally-public webcam
  directories** (EarthCam Moscow/Kyiv per-city pages; Skyline RU/UA directories), with
  real city coordinates and labelled provenance. **Re-test the URLs from the deploy host**
  — they may behave differently than from this box.
- **Expansion + private/unsecured cams:** see **`docs/CAMERA_SOURCES.md`** — documents the
  fetcher pattern for direct image/MJPEG/Windy feeds, plus Shodan host-search and Insecam
  for exposed cameras (RTSP→HLS relay via go2rtc/MediaMTX, read-only discovery, gate the
  layer behind auth).
- **Status:** a `SHODAN_API_KEY` is set (`.env`) but is the **free `oss` tier**, which
  **cannot do host search** — exposed-camera discovery is blocked until a paid Shodan
  membership is purchased (see #7). RU portal scraping additionally needs `RU_PROXY_URL`
  (see #7b) because the portals are geoblocked.
- **Touch points:** `src/app/api/cctv/route.ts`; markers render via the existing `cctv`
  layer in `OsirisMap.tsx` (no frontend change).

---

## Notes
- Shadow-fleet source is overridable via `SHADOW_FLEET_SOURCE_URL` (JSON array,
  `{imos:[...]}`, objects with `imo`/`imoNumber`, or any text containing `IMO 1234567`).
- `/api/air-raids` uses the keyless `vadimklimenko.com/map/statuses.json` feed (binary
  on/off per region, no threat type). `alerts.in.ua` would need a token and still has no
  KAB category — hence #2 went the Telegram-text route.
- `/api/kab-threats` knobs: `UA_THREAT_CHANNELS`, `KAB_PATTERNS`, `OBLAST_REFS`,
  `WINDOW_HOURS` (3), `CACHE_TTL_MS` (60s). Add oblasts/cities by extending `OBLAST_REFS`.
