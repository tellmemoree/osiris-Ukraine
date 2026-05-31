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

---

## Notes
- Shadow-fleet source is overridable via `SHADOW_FLEET_SOURCE_URL` (JSON array,
  `{imos:[...]}`, objects with `imo`/`imoNumber`, or any text containing `IMO 1234567`).
- The `/api/air-raids` route already uses the keyless `alerts.com.ua` endpoint
  (api.alerts.in.ua now requires a token), so no key is needed for decision #2.
