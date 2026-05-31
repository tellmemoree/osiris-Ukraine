# Handoff — osiris-Ukraine review follow-ups

Context: this branch was reviewed against TypeScript/Next.js best practices. The
items below were **fixed** in the review-cleanup commit; the **Open decisions**
are deliberately left for a maintainer call before implementation.

---

## Done in the review-cleanup commit

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

## Open decisions (need a maintainer call)

### 1. Remove synthetic "ghost ship" injection — `maritime/route.ts`
`fetchVesselApiFallback()` does **not** call a real API. When `VESSEL_API_KEY` is set
it fabricates 75–110 random vessels (`name: "V-SAT ####"`, `flag: "S-AIS"`) in the
Hormuz and Suez boxes, with randomized positions/speeds tuned to *deliberately trip*
the congestion + chokepoint-risk thresholds (`numHormuz = 45–65`, `numSuez = 30–45`).
This synthetic data is then served from `/api/maritime` indistinguishably from live AIS.

- **Risk:** fake "CRITICAL congestion" / "CRITICAL chokepoint" intel; undermines trust
  in every maritime signal and the `shadow_fleet` flagging built on top of it.
- **Options:**
  1. **Delete** `fetchVesselApiFallback()` and its `GET()` call (recommended — it is
     not a real integration).
  2. Gate behind an explicit `OSIRIS_DEMO=1` flag and label the ships as synthetic in
     the payload (e.g. `synthetic: true`) so the UI can mark them.
  3. Implement the real VesselAPI REST call sketched in the comment at the top of the
     function (needs an actual endpoint + key + response mapping).
- **Touch points:** function def ~L241, `await fetchVesselApiFallback()` in `GET()`,
  and the `// TODO: cross-reference against getShadowFleetImos() once the satellite
  feed provides IMO numbers` note.

### 2. Re-wire the KAB bomb-risk data path — `flights/route.ts`
`bomb_risk` is derived from ADS-B (`adsb.lol`). That feed only shows aircraft
*broadcasting* ADS-B, but aircraft actually releasing KAB/UMPK glide bombs near the
front fly with transponders **off**. So the planes we most want to flag are exactly
the ones the feed never shows — `bomb_risk` is structurally low-recall and is now
documented as a best-effort heuristic only.

- **Target design:** drive KAB threat from the **air-raid alert feeds**, not ADS-B.
  `alerts.com.ua` (already wired in `/api/air-raids`) exposes a threat type for KAB/
  guided-bomb warnings ("загроза застосування КАБ"). Surface that as the real signal;
  keep `isRussianMilitary()` + bounding box only as a supplementary ADS-B overlay.
- **Touch points:** `src/app/api/air-raids/route.ts` (add/parse threat-type field),
  `src/app/api/flights/route.ts` (`bomb_risk`, `isRussianMilitary`, `nearUkraineBorder`),
  and whichever map layer consumes `bomb_risk`.

### 3. Remaining lint / hygiene debt (pre-existing, out of review scope)
- **6 `@typescript-eslint/no-explicit-any`** in RSS-item parsing (not touched by this
  branch's feature work):
  - `src/app/api/gdelt/route.ts:90`
  - `src/app/api/news/route.ts:77, 78, 105, 106, 146`
  Fix by typing the parsed RSS item shape (a small `RssItem` interface).
- **CRLF across the repo:** 27 of ~87 API route files are still CRLF; only the 3 files
  this branch touched were normalized. `.gitattributes` is now in place — run
  `git add --renormalize . && git commit` once to convert the rest in a single,
  reviewable pass.
- **ESLint is not blocking the build** (`next build` exits 0 despite the 6 errors).
  Consider enforcing lint in CI / removing any `eslint.ignoreDuringBuilds` so this
  debt can't grow silently.

### 4. Investigate: only ~2 shadow-fleet ships render on the map
The dynamic watchlist now holds ~1,940 IMOs, yet the map shows only ~2 vessels in the
`shadow_fleet` layer. The watchlist size is almost certainly **not** the problem — the
match path is.

- **Most likely cause:** a ship is flagged only when AIS **static data** (type-5
  message, the one carrying `ImoNumber`) arrives *and* its IMO is in the set. Position
  reports (type 1/2/3) — the vast majority of the stream — carry MMSI but **no IMO**, so
  most vessels are never cross-referenced. Static messages are broadcast infrequently
  (minutes apart), so within a cache window only a handful of ships ever get an IMO
  attached → only those can be flagged.
- **Also check:**
  - Whether the synthetic ghost ships (decision #1) dominate the payload — they have no
    IMO and can never be flagged, diluting the visible fleet.
  - The `ship-shadow-dots` layer filter in `OsirisMap.tsx`
    (`['==', ['get','shadow_fleet'], true]`) vs the base `ship-dots` filter
    (`['!=', ['get','shadow_fleet'], true]`) — confirm the split is consistent and the
    flag is actually serialized into the GeoJSON feature properties.
  - Whether `getShadowFleetImos().has(staticData.ImoNumber)` is comparing the same type
    (number vs string) — IMOs parsed from OFAC are `number`; AIS `ImoNumber` should be
    too, but verify no string leaks in.
- **Touch points:** `src/app/api/maritime/route.ts` (shadow flagging on static-data
  receipt), `src/lib/shadowFleet.ts`, `src/components/OsirisMap.tsx` (`ship-shadow-dots`).
- **Likely conclusion:** this is expected behavior of MMSI-only position streams, not a
  bug — but it should be confirmed and, if so, documented (consider persisting an
  MMSI→IMO map across cache windows so a ship stays flagged after its one static
  message, rather than re-losing the IMO each refresh).

### 5. Investigate: red oblast fills for active air-raid alarms render incorrectly
The oblast/rayon polygon fills added in `1a0bec7` ("oblast/rayon polygon fills for air
raids") paint the wrong regions / render incorrectly. **A screenshot will be provided**
when this is picked up — do not start without it.

- **Suspects to check (in priority order):**
  1. **Name matching** between the alert feed (`alerts.com.ua` oblast names, in
     Ukrainian/transliterated) and the polygon source's `properties.name` — a mismatch
     would light up the wrong oblast or none.
  2. **GeoJSON ring winding / coordinate order** — fills require `[lng, lat]` order and
     correct outer-ring winding; an inverted ring fills the *complement* of the polygon
     (everything except the oblast).
  3. **Filter/feature-state wiring** on the `air-raid-alerts` layer in `OsirisMap.tsx` —
     whether "active" is matched per-feature or applied to all polygons.
  4. Disputed-border / Crimea polygons (hidden per `1a0bec7`) leaking into the active set.
- **Touch points:** `src/app/api/air-raids/route.ts` (alert→oblast mapping),
  `src/components/OsirisMap.tsx` (`air-raid-alerts` source + fill layer), and the oblast
  polygon GeoJSON asset.

### 6. (This session) React #418 hydration warning — likely benign
A `Minified React error #418` (React 19.2.4 hydration mismatch) was observed in the
console. Audited every first-paint render path — clocks, `localStorage`/`window` reads,
render-time `toLocaleTimeString()`, the root layout, and the splash — **all are correctly
deferred or gated**, so the app code is clean on this front. The remaining realistic cause
is a **browser extension** mutating the DOM before hydration (the error message lists this
explicitly). Confirm via Incognito + extensions-off hard reload; if it vanishes it's an
extension and can be ignored. Belt-and-suspenders fix if desired: `suppressHydrationWarning`
on `<body>` in `layout.tsx` and harden the `typeof window` branch in `SharePanel.tsx:32`.

---

## Notes
- Shadow-fleet source is overridable via `SHADOW_FLEET_SOURCE_URL` (JSON array,
  `{imos:[...]}`, objects with `imo`/`imoNumber`, or any text containing `IMO 1234567`).
- The `/api/air-raids` route already uses the keyless `alerts.com.ua` endpoint
  (api.alerts.in.ua now requires a token), so no key is needed for decision #2.
