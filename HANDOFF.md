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
and persisting across the ship's lifetime. Expect a meaningfully higher count (still
bounded by how many sanctioned tankers actually broadcast a valid IMO in the sampled
boxes, but no longer artificially dropped).

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

### 5. ⏳ BLOCKED ON SCREENSHOT — red oblast fills render incorrectly
The oblast/rayon polygon fills from `1a0bec7` paint the wrong regions. **A screenshot
will be provided** when this is picked up — do not start without it.

- **Suspects (priority order):**
  1. **Name matching** between the feed and the polygon `properties.name_en`/`name_ua`.
     NB the feed is `vadimklimenko` (Ukrainian state names like `Харківська область`),
     and the fill filter normalizes apostrophes (`OsirisMap.tsx` ~L1376) — a mismatch
     lights the wrong oblast or none.
  2. **GeoJSON ring winding / coordinate order** — fills need `[lng,lat]` and correct
     outer-ring winding; an inverted ring fills the *complement* (everything except the
     oblast — a classic "whole map is red" symptom).
  3. **Filter wiring** on `raid-oblast-fill`/`raid-district-fill` (`OsirisMap.tsx`
     ~L1378-1388) — oblast vs district `setFilter` literals.
  4. Crimea/disputed-border polygons leaking into the active set.
- **Touch points:** `src/app/api/air-raids/route.ts` (alert→oblast mapping, uses
  `OBLAST_INFO` Ukrainian keys), `src/components/OsirisMap.tsx` (`air-raid-alerts` source
  + `raid-oblast-fill`/`raid-district-fill` layers), and the oblast polygon GeoJSON asset.

---

## Notes
- Shadow-fleet source is overridable via `SHADOW_FLEET_SOURCE_URL` (JSON array,
  `{imos:[...]}`, objects with `imo`/`imoNumber`, or any text containing `IMO 1234567`).
- `/api/air-raids` uses the keyless `vadimklimenko.com/map/statuses.json` feed (binary
  on/off per region, no threat type). `alerts.in.ua` would need a token and still has no
  KAB category — hence #2 went the Telegram-text route.
- `/api/kab-threats` knobs: `UA_THREAT_CHANNELS`, `KAB_PATTERNS`, `OBLAST_REFS`,
  `WINDOW_HOURS` (3), `CACHE_TTL_MS` (60s). Add oblasts/cities by extending `OBLAST_REFS`.
