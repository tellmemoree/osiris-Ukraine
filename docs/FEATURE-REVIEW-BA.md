# OSIRIS — Shipped Feature Review (BA Audit)
**Date:** 2026-06-07  
**Scope:** All shipped intelligence layers and supporting routes  
**Author:** OSIRIS BA Agent (osint-idea-groomer)

---

## How to read this document

Each feature section follows the same structure:
- **Data source quality** — upstream reliability, rate limits, geoblocking exposure
- **Coverage gaps** — what the layer structurally cannot see
- **False positive risk** — conditions that produce noise
- **Classifier gaps** (where text classifiers are used) — missing and over-triggering terms
- **Cross-layer opportunities** — how this layer could be corroborated or enriched
- **Bilateral coverage** — symmetry of UA/RU perspective
- **Recommended refinements** — P1/P2/P3 action items

---

## 1. Thermal Strike AOIs (`/api/strategic-thermal`)

### Data source quality
- **NASA FIRMS** (SUOMI VIIRS C2 + MODIS C6.1): keyless, 24h CSV, reliable uptime. VIIRS is preferred — 375 m resolution vs MODIS 1 km. Latency is ~3h from satellite overpass to CSV publication. Route tries VIIRS first, MODIS as fallback — correct.
- **Passthrough to `/api/news`**: introduces a second network call inside the request; if news is slow (>8s) the thermal route degrades gracefully but returns all news-backed AOIs as `confidence: 'news'` (no fire corroboration), which inflates the unverified marker count.
- No API key required. No rate-limit exposure on FIRMS; the CSV is a static file served by EOSDIS.
- The 10-min cache (`s-maxage=600`) is appropriate for FIRMS latency characteristics.

### Coverage gaps
- **Naval vessels at sea**: FIRMS detects surface fires, not ship fires at sea unless the vessel is very close to shore or burning at high intensity. A struck warship in open Black Sea waters will not register a thermal hit. The Moskva sinking and any future ship strikes are invisible to this layer.
- **Underground/hardened targets**: strikes on bunkers, tunnels (Azovstal-type), and hardened aircraft shelters produce no surface thermal signature even when the munition penetrates.
- **Nighttime low-FRP events**: a precision munition causing a small fire (e.g. generator building, comms relay) may fall below the FIRMS detection threshold (~5 MW FRP minimum for reliable detection). Low-value infrastructure strikes are systematically under-represented.
- **Crimea bridge**: the Kerch Strait bridge is a confirmed historical strike target not in SITES. Bridge fires produce very low FRP and are unlikely to be caught by FIRMS. The thermal layer cannot cover infrastructure-denial targets that don't burn.
- **Warehouses and covered storage**: a covered ammunition depot may detonate but burn briefly; FIRMS 24h window may miss a fire that was extinguished within hours of detection.
- **BBOX east edge**: `lngMax: 66` excludes Ural-region refineries (Tyumen: 68.3°E). The THERMAL-AOI-CLASSIFIER.md doc recommends extending to 70 — this has not been implemented.
- **Olenya airbase** (68.15°N, 33.46°E) is in SITES but sits at the northern BBOX edge. VIIRS polar orbit coverage is actually better at high latitudes, so this isn't a coverage gap in practice.
- **Pskov airbase** (57.79°N, 28.39°E): Tu-95 storage and recent UAV attack target — not in SITES. Within BBOX.
- **Taganrog Beriev plant** (47.16°N, 38.90°E): A-50 AWACS production/maintenance — in the gazetteer as a city coord, but no dedicated SITE entry distinguishing it from `af-taganrog`.

### False positive risk
- **Agricultural burning**: spring/summer biomass burns across the Russian steppe generate widespread FIRMS hits. Low-confidence markers (no glow) partially mitigate this, but oblast-wide burn events can produce 50+ markers that crowd the `news` confidence tier.
- **Industrial gas flares** near refineries (Saratov, Volgograd areas): continuous flares can match as FIRMS hits near oil SITES. The `confidenceOf()` logic correctly downgrades single low-FRP fires, but a persistent flare over multiple days would always show as `hit: true`.
- **`burn`/`горить`** in STRIKE_TERMS: still catches "forest fire" and "wildfire" articles in warm months. These are likely the biggest source of unverified news-AOI noise. The `wildfire` term was removed (2.3b), but the stem `burn` was retained and will still match wildfire news coverage.
- **Digest/historical guards**: correctly exclude `^(главное за|сводка|...)` titles, but do not exclude: (a) anniversary posts with years 2022–2025 in the title (e.g. "3 years since the Kramatorsk strike — we remember"), (b) posts in non-title position (the digest title check only fires on `item.title`, not on description).
- **`депо`** (depot) in Cyrillic: `'склад'` (storehouse/warehouse) is in STRIKE_TERMS but is also used by Telegram posts as "military warehouse" generically. Posts about small front-line supply point hits near Pokrovsk will match even though there is no curated SITE near that centroid — the news AOI fires without a FIRMS corroboration and shows as `confidence: 'news'`.

### Classifier gaps
STRIKE_TERMS as shipped after 2.3b:

**Still missing:**
- `'судно'` — vessel/ship in Russian, complements `'корабл'` for incidents involving ships that are not warships (e.g. oil tanker attack in Black Sea)
- `'вертольот'` / `'гелікоптер'` — helicopter; a grounded helicopter fire at a field airfield will be classified correctly by `'пожеж'` but a destruction notice ("вертоліт знищено") may not surface if the article lacks other strike verbs
- `'підрив'` — Ukrainian: "blown up / mined" — a common formulation for infrastructure sabotage; NOT covered by `'вибух'` alone (вибух = explosion event, підрив = the act of blowing up)
- `'тяговая подстанция'` / `'підстанц'` — electrical substation; a frequent UA drone target that generates no fire but may generate news mentions without `'електростанц'` matches
- `'нафтопровід'` / `'нефтепровод'` — oil pipeline; pipeline hits are a separate category from depot fires and are missed

**Potentially over-triggering:**
- `'depot'` (EN): matches `"the troops were at their depot"` — military depot in a resupply context rather than a strike context. Low risk given the FIRMS co-location requirement, but a news-only AOI (no fire corroboration) can still fire on this.
- `'destroyed'` + `'ammunition'`: combined coverage is broad; "Russia claims to have destroyed Ukrainian ammunition" posts will classify as strike-related with the target assumed to be the named location (a UA city), producing an AOI marker in what is actually a RU MoD denial claim about a UA target.

### Cross-layer opportunities
- **Air Raid Alerts**: an active air-raid alert in the same oblast as a thermal hit dramatically raises the probability the thermal hit is a strike, not a wildfire. This co-occurrence is not currently surfaced in the thermal popup or used to bump confidence. The threshold-alerts route handles the reverse (FIRMS hit on airfield triggers an alert) but not the forward direction.
- **KAB Threats**: a KAB threat in the same oblast as a thermal AOI means a glide-bomb vector is confirmed — high-confidence circumstantial evidence. Not joined.
- **Captures layer**: a territorial advance report near a thermal AOI at the same location suggests the fire may be a retreating-army demolition rather than a strike. Inversely, combining thermal + captures for the same cell and same hour is a strong forward-area-engagement signal. Not joined.
- **News Geo-Dots**: thermal AOIs already consume `/api/news` internally, but the `news_intel` map layer dots are a separate population. Highlighting thermal-corroborated news items with a distinct visual treatment in the news layer would aid cross-referencing from the news side.

### Bilateral coverage
Reasonably balanced. UA_CHANNELS (22) outweigh RU_CHANNELS (9) in `/api/news`, which the thermal route consumes. The `bilateral` flag (shipped 2.3b) correctly surfaces when both sides report a cell. RU-perspective sources are adequate for strike confirmation (wargonzo, mod_russia, milinfolive) but thin for denial/counter-claim analysis. `colonelcassad` is NOT in the news channel list — he is the most systematic RU-side documenter of Ukrainian strikes on Russian infrastructure and his absence reduces bilateral hit rates.

### Recommended refinements
- **P1**: Add `colonelcassad` to `RU_CHANNELS` in `news/route.ts`. This single addition is the highest-ROI bilateral coverage improvement available — he documents UA strikes with target names and weapon types. Verify `/s/` scrapability first.
- **P1**: Extend `BBOX lngMax` from 66 to 70. Low risk, covers Ural refineries. Matches the THERMAL-AOI-CLASSIFIER.md recommendation.
- **P1**: Add `'підрив'` to STRIKE_TERMS (Ukrainian: "blown up") — common in SA drone/SSO posts and currently uncovered.
- **P2**: Add Pskov airbase to SITES (`id: 'af-pskov'`, lat: 57.79, lng: 28.39, category: `'airfield'`). It houses Tu-22M bombers and has been a confirmed UA UAV target.
- **P2**: Surface air-raid / KAB co-occurrence in the thermal popup: if `activeLayers.air_raids` shows an alert in the same oblast, show a "⚠ Air alert active" tag in the AOI popup.
- **P2**: Guard annual-anniversary posts in `isStrikeRelated` by detecting year-referencing patterns in description (not just title).
- **P3**: Split `af-taganrog` into two SITES: the airbase itself (Su-34 operations) and the Beriev aircraft plant (A-50 AWACS), which is ~3 km away but a separately significant target.
- **P3**: Add `'судно'`, `'підстанц'`/`'тяговая подстанц'`, `'нафтопровід'` to STRIKE_TERMS.

---

## 2. Territorial Captures (`/api/captures`)

### Data source quality
- Entirely downstream of `/api/news` — no independent source. Quality ceiling is the news route's Telegram scraping quality. No caching here beyond the news route's own `s-maxage=60`; the captures route is `force-dynamic` and makes a fresh internal fetch every call. This doubles the Telegram scrape load when both routes are polled simultaneously by the frontend.
- 5-minute cache (`s-maxage=300`) is appropriate given the news source.

### Coverage gaps
- **Requires `coords` to not be `coords_default`**: articles that mention a territorial change but whose location maps only to a broad key (`ukraine`, `россия`, `крым`) are dropped entirely. This is correct behavior for precision, but means that any capture claim in an area not in the gazetteer (e.g. a newly significant village not yet added) will be silently excluded.
- **Front-line villages below city level**: the gazetteer covers towns like Selydove, Myrnohrad, Hrodivka — but dozens of tactical villages (Krasnohorivka, Nevelske, Nevske, Stepove, Urozhaine) are absent. Captures near those villages are placed at the nearest named city, which for tight front-line fighting introduces ~5–10 km positional error and can falsely attribute a village capture to the wrong settlement.
- **Villages in Kursk oblast (Sudzha area)**: the `sudzha` entry was added, but adjacent villages Kozinka, Nikolaevo-Darino, Zvannoye, Plekhovo are absent. The Kursk incursion produced significant territorial messaging about those specific villages.
- **Temporal decay**: captures accumulate across the 24h news window with no recency weighting. A capture claimed 23 hours ago that was subsequently walked back by both sides still appears on the map alongside fresh reports.
- **No deduplication with frontline**: a capture claim at Pokrovsk (48.279, 37.176) appears as a marker even when the DeepState frontline shows Pokrovsk is clearly in UA-controlled territory — no spatial join to sanity-check claims against the frontline polygon.

### False positive risk
- **`captureSide()` defaulting to `'ru'`**: when both UA and RU are mentioned in the same article, the function returns `'ru'` on the assumption RU is on the offensive. This is directionally correct for the current front but will misclassify UA counter-attack reports ("Ukrainian forces repelled Russian attack near Pokrovsk") as RU captures.
- **`'захопл'` (Ukrainian: seized/captured)**: this term is used in both "Russian forces seized..." and "terrorists seized a vehicle..." contexts. Non-military seizure articles geolocated near front-line towns will produce RU capture markers.
- **`'штурм'` in ADVANCE_TERMS**: "шторм" (storm, weather) is only 1 character different. The Unicode word-boundary check (`re: startsWith`) should prevent this collision, but Cyrillic 'ш' is not at a word-boundary-ambiguous position — this is low risk but worth verifying.
- **`'під контроль'`**: very common phrase in UA military updates ("взяли під контроль позиції" = took up positions), not just territory control-change reports. Can fire on position-taking at checkpoints, not just settlement captures.
- **Historical year guard**: only checks years 2014–2021 in the title. Posts about the 2022 battles (e.g. "how Mariupol fell in 2022") or anniversary posts in 2024–2025 referencing events from the first weeks of the full-scale invasion are not filtered.

### Classifier gaps
ADVANCE_TERMS as shipped after 2.3b:

**Still missing:**
- `'відійшли'` — retreated (UA: "Ukrainian forces withdrew from X") — the implicit side-flip: if UA retreated, RU advanced. Currently classified only if additional RU terms are present.
- `'залишили'` — abandoned (UA: "abandoned the settlement") — same gap as `'відійшли'`
- `'ворог увійшов'` — "the enemy entered" — common UA phrasing for RU capture without naming the captor explicitly
- `'наши зашли'` (RU informal: "our guys entered") — common in RU milblogger posts confirming an advance without formal military language
- `'котёл'` / `'котел'` — encirclement reports; a settlement being encircled is a precursor to capture, high value for the layer

**Over-triggering:**
- `'відбили'` (rebuffed, repelled): "Ukrainian forces repelled the attack" uses this term to describe a DEFENSIVE success — no territorial change. This will be misclassified as a UA advance, inflating the UA capture count.

### Cross-layer opportunities
- **Frontline overlay**: a spatial join between new capture markers and the DeepState frontline polygon would allow flagging captures claimed "deep" in established control territory as outliers requiring extra scrutiny.
- **Thermal AOIs**: when the same gazetteer cell appears in both a capture report and a thermal hit within the same 3h window, the correlation is strong (shelling during an assault). This joint signal is not currently surfaced anywhere.
- **Air Raid Alerts**: an active oblast-level air raid concurrent with a capture claim in that oblast may indicate suppression of the counterattack — militarily relevant co-occurrence.

### Bilateral coverage
The `captureSide()` function is the main symmetry mechanism. It correctly handles both sides' capture language. However, the underlying news channels are weighted ~70% UA (22 channels) to ~30% RU (9 channels), so RU advance claims from milbloggers are under-sampled relative to UA channels reporting UA successes. Given RU has been the advancing party on most axes, this means the RU capture marker count is likely understated relative to actual territorial claims by Russian sources.

### Recommended refinements
- **P1**: Extend HISTORICAL_YEAR_RE to `201[4-9]|202[0-4]` — anniversary posts about 2022–2024 events are now common and are not filtered.
- **P1**: Add `'відійшли'` and `'залишили'` to ADVANCE_TERMS with `side: 'ru'` implied (retreat = adversary advance). These are high-frequency UA military update terms that currently produce a coverage gap.
- **P2**: Add gazetteer entries for key Kursk incursion villages: Kozinka (51.33°N, 35.25°E), Zvannoye (51.35°N, 35.22°E), Plekhovo (51.16°N, 35.26°E).
- **P2**: Extend the captures route to accept a `?since=<ISO>` param so the frontend can request only captures newer than the last poll — enables incremental updates without re-rendering all markers on every poll cycle.
- **P3**: Evaluate removing `'відбили'` from ADVANCE_TERMS. It creates more false UA-advance markers than it catches genuine ones — the "rebuffed" framing almost always describes a defensive hold, not a territorial gain.
- **P3**: Add a temporal decay field (`age_hours`) to each capture so the frontend can visually fade markers older than 6h.

---

## 3. News Geo-Dots (`/api/news`)

### Data source quality
- **Telegram `t.me/s/` scraping**: the web preview endpoint is the most fragile dependency in the entire system. Telegram can disable `/s/` previews per-channel (it is a channel owner opt-out). As of the THERMAL-AOI-CLASSIFIER.md research, `@rybar` already has `/s/` disabled — if any of the 31 current channels follows, that channel goes dark silently (the `if (!res.ok) return []` swallows the failure).
- **No staleness detection**: the route has no module-level cache (`force-dynamic` but no TTL). Every request fires 31 parallel Telegram fetches + 3 RSS fallbacks. At the default 60s polling interval from `page.tsx`, this is 31 HTTP requests per minute per active session. On a shared IP this will eventually trigger Telegram rate-limiting (typically HTTP 429, which `if (!res.ok) return []` handles by silently dropping that channel).
- **8-second per-channel timeout**: reasonable, but 31 concurrent fetches with 8s timeout means the route can block for up to 8 seconds even with all requests parallel, before the `Promise.allSettled` resolves. Under load this is the slowest route in the system.
- **RSS fallback** (BBC, Al Jazeera, GDACS): only activates if ALL Telegram channels return zero items. This threshold is too high — a 50% channel failure (partial Telegram block) still produces items and never triggers the fallback. The fallback should activate when items < a minimum threshold (e.g. < 10).

### Coverage gaps
- **`@rybar` is missing**: Rybar is the most widely read Russian milblogger and one of the most authoritative RU-perspective sources. Its `/s/` preview is disabled, so it cannot be scraped. Its absence creates a systematic gap in Russian operational reporting. No workaround until Rybar re-enables `/s/` or a third-party mirror is found.
- **Ukrainian Air Force official** (`@PovitryanaT`): not in UA_CHANNELS. Posts weapon-type breakdowns during attacks — high value for the kab-threats and news layers.
- **`@khortytsia_ua`** (Operational-Strategic Group Khortytsia): Joint Forces command, posts detailed strike reports covering the southern and eastern axes. Not in UA_CHANNELS.
- **`@operativnoZSU`** IS in UA_CHANNELS as `operativnoZSU` — verify channel name matches (some channels use camelCase inconsistently).
- **`@V_Zelenskiy_official`**: high-authority strike confirmation source (as identified in THERMAL-AOI-CLASSIFIER.md section 1.1) not in the news route. Posts are low-volume but high-signal (official confirmation of strategic strikes).
- **`@gruntmedia`** (ҐРУНТ): balanced bilingual news, noted as medium quality in the classifier doc — not yet added.
- **No maritime channels**: Black Sea naval incidents (drone boat attacks, ship strikes) are covered in text by ssternenko and informnapalm, but there is no dedicated maritime-intelligence Telegram source in the channel list. `@BlackSeaNews` and `@KrimskyVeter` cover Crimea/Black Sea naval activity.
- **Gazetteer misses** — structural gaps in named locations:
  - `'toretsk'` exists in Latin but the Cyrillic `'торецьк'`/`'торецк'` are also present — verify both resolve to the same coords. They do (48.415, 37.820) — OK.
  - `'velyka novosilka'` is in the gazetteer (47.844, 36.797) but the Cyrillic `'велика новосілка'`/`'велика новоселка'` are not. Active front, high mention frequency.
  - `'vuhledar'` is in Cyrillic (`'вугледар'`, `'угледар'`) but NOT in Latin. English-language OSINT posts about Vuhledar will fail to geolocate.
  - `'bilohorivka'` (47.91°N, 38.09°E): Luhansk oblast — active fighting, not in gazetteer.
  - `'lyptsi'` (50.16°N, 36.49°E): Kharkiv oblast — active front north of Kharkiv, absent.
  - `'urozhaine'` (47.51°N, 36.98°E): South Donetsk axis, absent.

### False positive risk
- **`'атак'` Cyrillic stem**: matches `"атака серця"` (heart attack) in medical news; `"атакованій"` in a sports metaphor. These are rare in military channels but possible in generalist sources like `@suspilne_news`.
- **`'бій'` (battle/fight) and `'бой'`**: common in sports and cultural contexts. `@hromadske_ua` and `@truexanewsua` post general news where these terms occur in non-military contexts. The `isConflict()` filter requires any single term match — a sports "battle" article will pass.
- **`'дрон'` + geolocation**: drone delivery, racing drone, and commercial drone news will pass the conflict filter if combined with a Ukrainian city name. Under-represented given the current channel mix (predominantly military-focused), but possible with `@suspilne_news`.
- **`scoreRisk()` max-capping at 10**: a post mentioning `'strike'`, `'missile'`, `'shelling'`, `'artillery'`, `'frontline'`, and `'occupied'` all scores 10/10. The risk score no longer discriminates between a medium-severity report and a CRITICAL one once the maximum is reached.
- **`machine_assessment` hardcoded text**: items with `risk_score >= 8` show `"AI Analysis indicates elevated tactical priority based on OSINT stream patterns."` — this is a static string masquerading as AI analysis. Users treating this as genuine AI output are being misled. Backlog item 5.9 addresses this but is not yet shipped.

### Cross-layer opportunities
- **Thermal corroboration**: already implemented (strategic-thermal calls /api/news internally). Inverse not implemented: the `news_intel` dots on the map do not visually distinguish items that were also flagged as thermal AOI contributors.
- **Captures**: already consumes /api/news internally. Same cascade relationship.
- **Air Raids**: no join. A news item mentioning a specific city whose oblast has an active air raid alert is qualitatively more urgent than an item in a quiet area. Risk-score boosting for "article location has active alert" would improve triage quality.
- **KAB Threats**: same opportunity — a news item naming an oblast with an active KAB threat deserves elevated priority.

### Bilateral coverage
- 22 UA + 9 RU channels. The imbalance is structurally intentional (UA OSINT community is larger and more English-accessible) but meaningful for the captures layer.
- RU channels: `milinfolive`, `wargonzo`, `epoddubny`, `sashakots`, `dva_majora`, `voenkorKotenok`, `rvvoenkor`, `grey_zone`, `mod_russia`. `grey_zone` (Wagner/Africa) and `grey_zone` are identified in THERMAL-AOI-CLASSIFIER.md as not useful for Ukraine theater. Dead weight that consumes a scrape slot.
- Missing from RU side: `colonelcassad` (highest value), `readovkanews` (infrastructure damage confirmation).

### Recommended refinements
- **P1**: Add module-level 5-minute cache to `/api/news` (see backlog item 5.9). Every downstream consumer (strategic-thermal, captures, digest) currently triggers a full re-scrape. A single cached response would cut Telegram fetch load by ~95%.
- **P1**: Replace the hardcoded `machine_assessment` string with `null` until 5.9 (AI enrichment) ships. Showing a fake AI assessment is worse than showing nothing.
- **P1**: Add `velyka novosilka` Cyrillic variants and `vuhledar` Latin to the gazetteer. Both are high-frequency frontline names missing from one script variant.
- **P2**: Add `@V_Zelenskiy_official` to UA_CHANNELS. Low volume, high authority, confirms strategic strikes.
- **P2**: Add `@khortytsia_ua` to UA_CHANNELS. Eastern/southern axis operational updates.
- **P2**: Replace `@grey_zone` with `colonelcassad` in RU_CHANNELS — grey_zone covers Africa PMC, not Ukraine; colonelcassad is the top-value missing RU bilateral source.
- **P2**: Lower the RSS fallback trigger from "all channels empty" to "items < 10" to catch partial Telegram outages.
- **P3**: Add `lyptsi`, `bilohorivka`, `urozhaine` to the gazetteer.
- **P3**: Expose a `channels_failed: number` field in the response so the frontend can show a data quality degradation warning when Telegram is partially blocked.

---

## 4. KAB / Glide-Bomb Alerts (`/api/kab-threats`)

### Data source quality
- Same `t.me/s/` Telegram scraping exposure as the news route. 8 channels, 3h recency window, 60s module-level cache.
- `stealthFetch` is used (rotated User-Agent), which reduces Telegram bot-detection risk vs. a fixed UA.
- The 60s in-memory cache + inflight coalescing is correct. But the cache is process-local — after a Next.js restart (which happens after every OSIRIS rebuild), the cache is cold and all 8 channels are re-scraped on the first request. This is fine.
- The 3-hour recency window is conservative. A KAB threat from 2h 55min ago that is no longer relevant will still appear. KAB launches typically evolve to impact or interception within 20–40 minutes. Reducing the window to 90 minutes would improve relevance without losing first-report coverage.

### Coverage gaps
- **Oblast coverage has only 9 oblasts**: Kharkiv, Sumy, Zaporizhzhia, Kherson, Donetsk, Dnipropetrovsk, Chernihiv, Mykolaiv, Poltava. Missing:
  - `Luhansk oblast` (39.300, 48.566): active front, Kalibr/KAB targets. Not in OBLAST_REFS.
  - `Odesa oblast` (30.723, 46.482): Black Sea coast, naval drone targets, Shahed corridor. Not in OBLAST_REFS.
  - `Kyiv oblast` / `м. Київ` (30.523, 50.450): ballistic missile targets. Not in OBLAST_REFS.
  - `Zhytomyr oblast`, `Rivne oblast`, `Khmelnytskyi oblast`: western UA oblasts receiving Kalibr/Kh-101 strikes on energy infrastructure. None in OBLAST_REFS.
  - `Vinnytsia oblast` (28.468, 49.233): frequent Kalibr/Kh-101 transit corridor. Not in OBLAST_REFS.
  - `Kirovohrad oblast` (32.262, 48.508): energy infrastructure targets. Not in OBLAST_REFS.
  - `Kharkiv oblast` IS covered but missing `'ізюм'`/`'izium'` in its token list (it has `'ізюм'` — check capitalization; it's lowercase so this should match).
- **Weapon-type blindness**: all detections are returned as `alertType: 'KAB'` regardless of whether the message actually mentions a Shahed, Kalibr, Iskander, or Kinzhal. A `@kpszsu` post confirming "12 Shaheds launched from the Black Sea" will match `KAB_PATTERNS` only if it incidentally includes a KAB mention in the same message. The layer is functionally a "UAV/bomb threat" layer, not a KAB-specific layer.
- **`@PovitryanaT`** (Повітряні Сили ЗСУ — UA Air Force official): not in `UA_THREAT_CHANNELS`. This channel posts real-time weapon-type breakdowns during attacks. It is the highest-signal source for KAB tracking that is currently absent.
- **No district-level resolution**: all KAB threats are placed at oblast centroid, regardless of which raion within the oblast was mentioned. Contrast with `/api/air-raids` which has district-level coordinates. KAB messages often name specific cities within the oblast (`"КАБ у бік Куп'янська"`) but the attributor only checks oblast-level tokens.

### False positive risk
- **`'каб'` collision risk**: `(?<!\p{L})каб(?:и|ів|ами|ах|у)?(?!\p{L})` — the pattern requires a word boundary using `\p{L}` look-arounds. This should prevent `'кабінет'` (cabinet), `'кабель'` (cable), `'Кабул'` (Kabul). Verified correct.
- **`'планирующая бомба'` (RU: glide bomb)**: this pattern is broad. Any RU milblogger post describing *any* type of bomb as "gliding" will match. Very low risk in practice given channel composition.
- **Channels that are not KAB-specific**: `@DeepStateUA` and `@Militaryland` post operational maps and frontline updates that occasionally contain `'КАБ'` in a historical/analysis context ("КАБ використовувались з 2023 року"). These will produce false KAB alerts from analysis posts. The 3h recency window partially mitigates this, but does not eliminate it.

### Cross-layer opportunities
- **Air Raid Alerts**: the threshold-alerts route already implements the co-location rule (air raid + KAB in same oblast). This is the highest-value cross-layer join and is already shipped. Good.
- **News Geo-Dots**: a KAB threat in an oblast should visually boost risk priority for news items in that oblast. Not currently joined.
- **Thermal AOIs**: a KAB threat in the same oblast as a thermal AOI is a strong composite signal — glide bomb was launched AND a fire was detected. Not joined at display level.

### Bilateral coverage
All 8 channels are UA-aligned (`GeneralStaffUA`, `DeepStateUA`, `Militaryland`, `UkraineWarReport`, `ukraine_now`, `ua_forces`, `kpszsu`, `war_monitor`). There is no RU-side channel for KAB threats — the adversary perspective is not covered. The rationale is sound (RU would not confirm its own KAB launches), but adding `@mod_russia` to detect official Russian "strikes on Ukrainian military infrastructure" announcements would allow correlation between a RU claim and a KAB detection in the same oblast.

### Recommended refinements
- **P1**: Add Luhansk, Odesa, Kyiv, Vinnytsia, Khmelnytskyi, Rivne, Zhytomyr, Kirovohrad oblasts to `OBLAST_REFS`. These cover the most significant gaps in the current 9-oblast list.
- **P1**: Add `@PovitryanaT` to `UA_THREAT_CHANNELS`. It is the official UA Air Force public channel posting real-time weapon-type breakdowns during attacks.
- **P1**: Reduce `WINDOW_HOURS` from 3 to 1.5. KAB threats evolve to impact within 40 minutes; 3-hour retention is filling the layer with stale threat data.
- **P2**: Add city-level tokens to OBLAST_REFS for KAB-common target cities: `'слов'янськ'` / `'slaviansk'` in Donetsk, `'ізюм'` in Kharkiv, `'очаків'` in Mykolaiv (Ochakiv near Black Sea — frequent drone corridor mention).
- **P2**: Implement backlog item 5.8 (weapon taxonomy enrichment) — the KAB-only classification is the biggest analytical limitation of this layer, and the infrastructure (channels, Telegram scraping, oblast attribution) is entirely reusable.
- **P3**: Add a `stale_after` ISO field to each threat (based on `startedAt` + 90 min) so the frontend can visually fade threats that are past their actionable window.

---

## 5. Air Raid Alerts (`/api/air-raids`)

### Data source quality
- **vadimklimenko.com/map/statuses.json**: single-source dependency. No fallback. If this API goes down, the layer returns empty with no visual degradation warning to the user. The source is community-maintained and has a strong uptime history for Ukraine, but has no SLA.
- **No rate limiting or authentication**: the route hammers a third-party API at every request. With 60s polling from the frontend, this is 1 request/minute/active session. In a multi-user scenario this could cause issues for the shared vadimklimenko endpoint.
- **District-level coordinates** (`DISTRICT_COORDS`): stored as a static import — verify the file is comprehensive. Missing raion entries will produce alerts with `lat: null, lng: null`, which the map silently drops.
- `stealthFetch` used — appropriate, reduces detection risk.

### Coverage gaps
- **Russian-side alerts**: no Russian oblast alert layer. Belgorod, Kursk, Bryansk alerts from UA cross-border operations are completely absent. This is acknowledged in backlog item 5.7 (not yet shipped). The missing symmetry is the most significant coverage gap in the dashboard as a whole.
- **Alert start time only**: the feed provides `enabled_at` but not `expected_end` or any duration estimate. There is no way to distinguish an alert that started 4 hours ago and is still active from one that started 5 minutes ago. All active alerts look the same.
- **No alert reason**: the `alertType: 'AIR'` is hardcoded for all alerts. The feed does not distinguish between alerts triggered by ballistic missiles, cruise missiles, Shaheds, or fighter aircraft. See backlog item 5.8.
- **Occupied territory**: Luhansk, Donetsk, and occupied Zaporizhzhia/Kherson do not have Ukrainian government alert infrastructure. Alerts in those oblasts, if present in the feed, have limited meaning. The layer includes `'Луганська область'` in `OBLAST_INFO` but vadimklimenko may not receive accurate data for occupied areas.
- **Sevastopol typo**: `"Севастополь'"` (note trailing apostrophe) in `OBLAST_INFO` — this will fail to match the key returned by vadimklimenko. A mapping failure means Sevastopol alerts are dropped silently.

### False positive risk
- Very low. The vadimklimenko API is authoritative state data, not text-derived. Alert state is binary and sourced from the official Ukrainian air raid alert system.
- **Stale alert risk**: if vadimklimenko's endpoint returns a cached state with an alert that has since ended, the map shows an expired alert. This is a data source quality issue, not a code issue.

### Cross-layer opportunities
- **Threshold Alerts**: already implemented (air raid + KAB in same oblast). Good.
- **Thermal AOIs**: see above.
- **News Geo-Dots**: already benefiting from co-location awareness in the digest, not in the map display.
- **Frontline overlay**: oblasts with active frontline contact (Donetsk, Zaporizhzhia, Kherson, Kharkiv) will nearly always have air raid alerts — the combination is contextually meaningful but currently just visually overlapping layers without semantic correlation.

### Bilateral coverage
One-sided by design (Ukrainian alert system). The RU side gap is acknowledged in backlog item 5.7.

### Recommended refinements
- **P1**: Fix the Sevastopol `OBLAST_INFO` key — remove the trailing apostrophe from `"Севастополь'"`. Currently dropping all Sevastopol alerts.
- **P1**: Add a null-check fallback when vadimklimenko is down: return the last successful response (stale-serve) with a `stale: true` flag, rather than returning empty `alerts: []`. An empty layer is more alarming to an operator than a stale one.
- **P2**: Add an `age_minutes` field to each alert (computed from `startedAt`) so the frontend can visually age active alerts.
- **P2**: Implement backlog 5.7 (Russian oblast alerts) as a complementary `/api/ru-air-raids` route. This is the single highest-value gap for bilateral situational awareness.
- **P3**: Add a `district_coords_missing` counter to the response to surface incomplete district coverage in logs.

---

## 6. Frontline Overlay (`/api/frontlines`)

### Data source quality
- **DeepState** (`deepstate.com.ua`): the authoritative community-maintained frontline GeoJSON. Updated multiple times daily by a dedicated team. Strong reliability record.
- **Militaryland.net**: confirmed 404 (noted in ARCHITECTURE.md and HANDOFF). The route degrades gracefully to DeepState only. However, the code still attempts the Militaryland fetch on every request, introducing a ~10s timeout wait on every poll cycle. With a 30-minute cache (`s-maxage=1800`) this only fires occasionally, but the 10s timeout is wasteful for a known-dead endpoint.
- Cache is 30-minute (appropriate given DeepState update cadence).
- The `.map.features` bug was fixed (2.1). No known schema issues.
- No authentication required.

### Coverage gaps
- **Point features dropped visually**: OsirisMap renders fill + line layers for polygons only. DeepState returns 403 POI points alongside 119 polygon features. The points (labeled markers for notable positions, crossings, etc.) are fetched but never rendered. They contain potentially high-value positional data that is silently discarded.
- **Feature properties**: DeepState properties (`fill`, `stroke`, `name`) are used for rendering but `name` is not surfaced in a popup. Hovering over the frontline polygon shows nothing — no place name, no oblast, no status.
- **No "contested" vs "occupied" semantic distinction**: DeepState polygons have different `fill` colors for different zone types (occupied, contested, administrative boundary), but the rendering simply passes `['get', 'fill']` directly. There is no separate layer for contested zones vs. consolidated control, making it impossible to filter or highlight specific zone types.
- **Militaryland is dead but still attempted**: 100% of frontline loads incur a wasted 10s Militaryland timeout. The code should be updated to skip Militaryland entirely until there's evidence it recovers.

### False positive risk
- Very low. DeepState's data is expert-curated and ground-truth aligned. The main risk is a DeepState update lag when a rapid frontline change occurs (e.g. a fast RU advance that DeepState takes 6–12h to reflect). The layer should be understood as "as of the last DeepState update," not "current."
- **Polygon fill vs. stroke color**: if DeepState changes their color convention (which has happened historically), the visual rendering could become misleading without code changes.

### Cross-layer opportunities
- **Frontline Changes tracker**: already built and consuming the same data. Good.
- **Captures layer**: spatial join between capture claims and frontline polygons would allow "inside controlled territory" vs. "at the edge" classification.
- **Thermal AOIs**: a thermal hit within or just behind the frontline polygon (< 20 km) is qualitatively different from one deep in RU territory — the former could be artillery/frontline combat, the latter is more likely a strategic strike.
- **Air Raids**: oblasts with front-line contact can be auto-labeled in the air raid layer ("Frontline oblast") for additional operator context.

### Bilateral coverage
DeepState is UA-produced and UA-aligned. It is considered the most accurate public frontline resource but reflects the Ukrainian understanding of the front. Russian MoD and RU milblogger front-line maps would show different boundaries in some sectors. There is no RU-perspective frontline source feeding this layer.

### Recommended refinements
- **P1**: Disable the Militaryland fetch (comment it out, log a note). Every request currently waits up to 10s for a dead endpoint. Saves 10s from the frontline load path.
- **P1**: Add a click popup to the frontline layer showing at minimum the feature `name` property from DeepState. Currently the polygon is entirely non-interactive.
- **P2**: Render DeepState POI points as a separate optional sublayer (small labeled dots), controlled by an additional "Frontline POIs" toggle. They are already fetched and already in the features array.
- **P3**: Add a semantic layer legend for frontline zone types (occupied / contested / administrative boundary) derived from the `fill` color values, so operators understand what the color coding means.

---

## 7. Frontline Change Tracker (`/api/frontline-changes` + `FrontlineTracker.tsx`)

### Data source quality
- Entirely derived from DeepState via `/api/frontlines` — same upstream dependency.
- Snapshot persistence to `~/.osiris-data/frontline-history.json` is robust (survives rebuilds). 120-day cap is appropriate.
- Deltas are null until 2+ UTC days are recorded — correctly communicated in the UI.
- 1-hour cache (`s-maxage=3600`): appropriate given daily granularity of the metric.
- The equirectangular shoelace area calculation is accurate to within 1–2% at Ukraine latitudes. Sufficient for trend detection.

### Coverage gaps
- **Daily granularity only**: the snapshot is taken once per UTC day (or refreshed on the current day's entry). Intra-day swings from rapid advances or counterattacks are invisible until the next UTC day.
- **No per-axis breakdown**: the tracker reports the total RU-controlled footprint as a single number. A 6 km² gain could be 1 km² gained on four different axes, or a 20 km² gain on one axis with losses on others. The net number masks operational variance.
- **No trend visualization in the component**: `FrontlineTracker.tsx` shows the 24h and 7d delta with arrows but no sparkline. The `series` array is returned by the API but not rendered.
- **Measurement includes occupied Crimea and pre-war occupied Donbas**: the polygon area sum includes territory occupied since 2014 (Crimea, parts of Luhansk/Donetsk). The `delta` is still meaningful (it shows change from yesterday), but the absolute area figure (currently ~300,000 km²) is misleading as a "war" metric — it includes territory occupied before the full-scale invasion.

### False positive risk
- **DeepState polygon updates can introduce discontinuities**: DeepState occasionally redraws polygon boundaries (corrections, reclassifications) that produce a large apparent "gain" or "loss" overnight that is actually a mapping correction, not a real frontline change. There is no way to distinguish a real 50 km² advance from a 50 km² polygon correction.
- The `note: 'Tracking started — daily deltas appear after the next UTC day.'` is surfaced until 2 days of data exist, which is appropriate.

### Cross-layer opportunities
- **Axis Briefing** (backlog 5.6): the per-axis area breakdown proposed there would address the "single number" limitation above.
- **Intel Digest**: frontline delta is already in the digest prompt. Good.
- **Threshold Alerts**: large 24h deltas (e.g. > 50 km² in a day) could trigger a CRITICAL threshold alert. Not currently implemented.

### Bilateral coverage
Same DeepState dependency — UA-perspective only. A Russian-perspective area metric would require scraping RU MoD or a RU-aligned mapping source, which has no reliable public API.

### Recommended refinements
- **P1**: Render the `series` sparkline in `FrontlineTracker.tsx`. The API already returns the 120-day series; a simple SVG polyline would add significant operational context to the tracker card.
- **P2**: Add a threshold alert rule for delta_1d > 50 km² (significant daily advance). This would fire for any day with a major breakthrough and surface to Telegram.
- **P2**: Expose a `since_2022` boolean option that calculates area only from polygons that changed after Feb 2022 (requires DeepState to timestamp features — likely not available). Alternatively, baseline the delta tracking from a known Feb 24, 2022 snapshot area (publicly available: ~0 km²) and show "war-start delta" alongside daily.
- **P3**: Add hour-resolution snapshotting (6h intervals) as a config option for high-tempo periods.

---

## 8. Intel Digest / AI Briefings (`/api/digest` + `/api/threshold-alerts`)

### Data source quality
- **Gemini 2.0 Flash**: the AI model used. Free-tier rate limits apply; with 8 key slots (`GEMINI_API_KEY_1` through `_8`), the first available key is used. If all keys are exhausted or unconfigured, the route degrades to `buildRawSummary()` — correct.
- **1-hour cache**: appropriate. The digest is a situational snapshot, not real-time.
- **Cascade dependency**: the digest calls five internal routes (news, air-raids, kab-threats, maritime, frontline-changes). If any of those is slow or failing, the digest may be partially populated. `Promise.allSettled` handles failures gracefully.
- **Telegram delivery**: messages are sent as HTML-formatted text capped at 3800 characters. The cap is appropriate for Telegram's 4096-character limit. HTML injection is not sanitized — if a news article title contains `<script>` or malformed HTML entities, the Telegram message could render oddly. Low risk given channel composition, but worth noting.

### Coverage gaps
- **Thermal AOIs not in the digest**: the digest includes air raids, KAB threats, news, maritime shadow fleet, and frontline footprint — but not the `strategic-thermal` AOIs. A high-confidence thermal hit on an RU airfield is arguably the most operationally significant event the system can detect, yet it does not surface in the hourly digest.
- **Threshold alerts not in the digest**: the `threshold-alerts` route fires rules (air+KAB co-location, FIRMS airfield hit, shadow fleet at chokepoint) but these are never injected into the digest text. The two AI/alerting systems are parallel and non-composing.
- **Shadow fleet filter is narrow**: only ships within 200 km of 5 chokepoints (Bosphorus, Dardanelles, Kerch Strait, Suez, Gibraltar) appear in the maritime section. A shadow fleet vessel conducting a rendezvous in the mid-Black Sea (operationally significant but not near a chokepoint) would be omitted from the digest.
- **News sorted by risk_score, not recency**: the top 15 news items used in the digest are sorted by `risk_score` descending. A breaking development from 5 minutes ago with a risk_score of 7 may be hidden behind a 12-hour-old item with a risk_score of 9. Operational urgency is not purely a function of risk score.
- **No captures in the digest**: territorial capture claims from `/api/captures` are not included in the digest prompt. A significant RU or UA territorial advance would not appear in the AI-generated hourly summary.

### False positive risk
- **Gemini output is unchecked**: the model's `text()` output is sent directly to Telegram without validation. If Gemini hallucinates factual claims (a known risk with news-summarization tasks), those claims go to Telegram. The prompt instructs "facts only — no hedging," which increases the risk of confident-sounding hallucination.
- **`buildRawSummary()` still shows hardcoded `machine_assessment` warning**: the raw summary (no-Gemini path) correctly labels itself as raw, but the `news/route.ts` items embedded in the digest still carry the hardcoded `"AI Analysis indicates elevated tactical priority..."` string if `risk_score >= 8`. This fake AI text can make its way into the digest input and confuse the model.

### Cross-layer opportunities
- **Add thermal AOIs to digest prompt**: include the top 3 high-confidence thermal hits in the `[FRONTLINE]` or new `[STRIKE]` section.
- **Add captures to digest prompt**: include UA/RU capture counts and top 3 specific claims.
- **Compose with threshold alerts**: run threshold-alerts rules first, then pass triggered rules as explicit `[ALERT]` items in the Gemini prompt. Ensures the AI doesn't miss a threshold event that a statistical composite would catch.

### Bilateral coverage
The digest prompt is framed as monitoring "Russia-Ukraine conflict and global security" from a UA/Western operator perspective. The system prompt does not ask for balanced sourcing — it asks for "operationally significant items." Given the channel composition (70% UA-aligned), the digest will systematically reflect UA-favorable framing for contested events. For an OSINT operator this may be acceptable, but it should be documented.

### Recommended refinements
- **P1**: Add strategic-thermal AOIs (top 3 by confidence) to the digest prompt under a new `[STRIKE LEADS]` section.
- **P1**: Add captures data (`counts.ru` / `counts.ua` + top 3 by count) to the digest prompt under `[TERRITORIAL]`.
- **P2**: Add a compositing step that collects all active threshold alerts and prepends them to the Gemini prompt as `[THRESHOLD ALERTS]` — ensures a CRITICAL event is always prominently summarized.
- **P2**: Add a Telegram message sanitization step: HTML-escape any news titles before embedding in the message string to prevent malformed Telegram HTML.
- **P3**: Add a `published_max_age_hours: 2` filter option for the top-15 news selection, so breaking news displaces stale high-risk items in the digest.

---

## 9. Global Incidents (`/api/gdelt`)

### Data source quality
- **GDELT 2.0 GEO API**: the primary source is described accurately as "frequently down (404/timeout)." In practice, the GDELT GEO endpoint has significant availability issues — it is not a production-grade API and Googling "GDELT API reliability" returns consistent reports of intermittent failures. The fallback to RSS is the actual primary data source for most users.
- **RSS fallback quality**: 12 sources, including strong options (ISW, Kyiv Independent, Ukrinform, Ukrainska Pravda). However, the fallback is keyword geo-mapped using a 65-entry `GEO_DICT` — significantly smaller than `news/route.ts`'s 250+ entry `KEYWORD_COORDS`.
- **No caching at the module level**: `force-dynamic` with `s-maxage=300`. Every request triggers fresh GDELT fetch attempts (3 queries × 10s timeout = 30s potential block) before the RSS fallback. With the GDELT endpoint frequently returning 404, this wastes up to 30 seconds on dead requests on every page load that polls this layer.
- **`Meduza.io`** in RSS_FEEDS: Meduza is a Russia-focused independent outlet valuable for RU domestic coverage. However, its RSS feed URL format (`https://meduza.io/rss/all`) should be verified — Meduza has undergone CDN changes.
- **RFE/RL RSS URL** (`https://www.rferl.org/api/z_yqpiiuy-qxq`): this is a non-standard API-style URL and may be a short-lived token. Should be audited for validity.

### Coverage gaps
- **Coordinate accuracy**: GDELT assigns coordinates based on its own NLP geolocation, which is notoriously city-level at best and frequently wrong at the article level. A story about a missile strike in Kramatorsk may be placed in Kyiv if Kyiv appears earlier in the article.
- **RSS fallback geo-resolution**: the `GEO_DICT` uses `\b word-boundary` regex on a 65-entry dictionary. Many important front-line towns (Chasiv Yar, Selydove, Vuhledar, Toretsk, Myrnohrad) are absent. These stories will match `ukraine` and be jittered around 48.38°N, 31.17°E (the center of Ukraine), which is useless for tactical mapping.
- **No Cyrillic matching in the fallback**: `GEO_DICT` is entirely Latin. RSS feeds from `Ukrinform` and `Ukrainska Pravda` may publish content in Ukrainian with Cyrillic place names in the title/description. These will fail to geolocate.
- **`GEO_DICT` coordinate order inconsistency**: documented in the code (`[lng, lat]` here, opposite of `news/route.ts`). Not a bug (used correctly within this file) but a footgun if anyone copies a coord from here to the news route.
- **Jitter algorithm**: `const jitterLng = ((eventId * 137.5) % 200 - 100) / 100 * 1.5` — this is a purely index-based jitter, not content-hash based. Two different events at the same location will get different jitter offsets based only on the order they were processed, not their content. This means the same story appearing in two RSS feeds will be plotted at two different locations (both jittered from the same centroid but differently), creating duplicate markers.

### False positive risk
- **`CONFLICT_KEYWORDS` includes `'occupied'` and `'liberated'`**: these are common in historical/analytical pieces (e.g. "occupied France" in a WWII reference, "liberated" in a political speech). The GEO_DICT's word-boundary matching will then place these in the nearest known city if it contains e.g. "France" or "Europe."
- **`'military'`**: extremely broad. Any article mentioning a military (e.g. "military budget debate in Germany") will pass the filter and be geolocated to Germany.
- **Event type classification is crude**: type is assigned based on which GDELT query bucket the event came from (`protest/riot/unrest`, `conflict/military/attack/strike`, `coup/revolution/emergency`). This is not based on the article content and is frequently wrong.
- **The RSS 0.5° dedup threshold**: `Math.abs(e.lat - coords[1]) < 0.5 && Math.abs(e.lng - coords[0]) < 0.5 && e.name === name` — requires both proximity AND identical name. Two articles about the same conflict with slightly different titles from different sources will not be deduped even if they're about the same event.

### Cross-layer opportunities
- **News Geo-Dots**: GDELT and the news dots cover overlapping content (both consume global conflict news). There is likely significant topic overlap between the two layers, with no deduplication between them. A user enabling both layers sees the same story potentially twice.
- **Frontline overlay**: GDELT events within the frontline polygon area (occupied territory) that claim a UA-perspective framing should be flagged — these may be deliberate disinformation.
- **Intel Digest**: GDELT events are not included in the digest prompt. Adding the top 3 GDELT conflict events (excluding GDELT's Ukraine items, which are covered by the news route) would broaden the global situational picture.

### Bilateral coverage
- RSS sources are heavily UA/Western-aligned: Kyiv Independent, Ukrinform, Ukrinform War, UNIAN War, Ukrainska Pravda, Euromaidan Press (6 out of 12 sources are UA-produced). `Meduza` provides a Russia-critical Russian perspective. There is no pro-RU Russian outlet in the RSS list, but for global incidents (non-Ukraine coverage) this is less consequential.

### Recommended refinements
- **P1**: Add a module-level cache with a 10-minute TTL to avoid firing 3 GDELT queries + 12 RSS fetches on every request. At a 5-minute polling interval, the current setup means 2–3 full re-fetches of a ~30-second fetch pipeline per poll cycle.
- **P1**: Detect GDELT availability on startup: if GDELT returns 404 or empty on 3 consecutive attempts, flag it as dead and skip directly to RSS fallback without the 30s timeout penalty.
- **P2**: Expand `GEO_DICT` with the top 30 front-line city names from `news/route.ts`'s `KEYWORD_COORDS` (Chasiv Yar, Selydove, Toretsk, Vuhledar, Myrnohrad, Pokrovsk-axis towns). This improves the RSS fallback from "country-level blobs" to tactical-level placement.
- **P2**: Replace index-based jitter with content-hash-based jitter (same approach as `news/route.ts` `jitterAround()`). Prevents the same event appearing twice with different coordinates when it appears in multiple RSS feeds.
- **P3**: Add Cyrillic matching to `GEO_DICT` for the UA cities most likely to appear in Ukrinform/Ukrinform-War content. Even 10–15 Cyrillic entries would materially improve coverage.
- **P3**: Replace the GDELT type assignment (query-bucket-based) with a keyword classification on the article title, similar to the `CONFLICT_KEYWORDS` approach — at least distinguish `'strike'`/`'missile'`/`'drone'` events as `'military'` vs. `'protest'`/`'riot'` as `'unrest'`.

---

## Cross-layer synthesis

### Synthesis 1 — The module-level news cache is missing and is causing the highest systemic load

`/api/news` has no cache. It is called directly by the frontend (polling) AND internally by `/api/strategic-thermal` AND `/api/captures` AND `/api/digest`. At 60s polling with all layers active, the system makes `(1 frontend + 1 thermal + 1 captures + 1 digest) × 31 Telegram channels = 124 Telegram fetches per minute`. This is the single most impactful architectural gap in the entire backend. Adding a 5-minute module-level cache (as spec'd in backlog 5.9) would collapse this to 31 fetches per 5 minutes — a 10x reduction — and would make all downstream consumers faster. This must be P1 for the next dev session.

### Synthesis 2 — The oblast vocabulary between kab-threats and air-raids is misaligned

`/api/air-raids` covers 25 oblasts via `OBLAST_INFO`. `/api/kab-threats` covers only 9 oblasts via `OBLAST_REFS`. The threshold alert rule for "air raid + KAB in same oblast" (in `/api/threshold-alerts`) joins on the string `oblast` field. When an air raid fires in Odesa oblast, there will never be a matching KAB threat because Odesa is not in `OBLAST_REFS`. The join silently produces zero matches for 16 oblasts. The fix: expand `OBLAST_REFS` to all 25 oblasts in `OBLAST_INFO`. This is a one-file change with immediate correctness impact on threshold alerting.

### Synthesis 3 — The bilateral confidence system is incomplete without colonelcassad

The `bilateral: true` flag on thermal AOIs (shipped in 2.3b) is the right concept, but its effectiveness depends on having credible RU-side Telegram channels in the news route. Currently the RU channels include `grey_zone` (covers Africa, not Ukraine), `mod_russia` (denies all damage), and several milbloggers who are useful but inconsistent. `@colonelcassad` (Boris Rozhin) systematically documents Ukrainian strikes on Russian infrastructure with site names, dates, and weapon types — he is the most reliable RU-side bilateral confirmation source not yet added. Adding him to `RU_CHANNELS` in `news/route.ts` would materially improve the bilateral hit rate for thermal AOIs, captures, and the digest's overall fidelity. He must be verified for `/s/` scrapability before implementation.

### Synthesis 4 — Severance between Threshold Alerts and the Intel Digest creates a blind spot

The `threshold-alerts` route evaluates composite rules (air+KAB co-location, FIRMS airfield hit, shadow fleet at chokepoint). The `digest` route assembles situational context. These two systems are parallel and never compose: a CRITICAL threshold alert fires to Telegram as a standalone notification, but the same event does not appear in the next hourly digest. An operator who misses the threshold alert will not see it in the digest. Injecting active threshold alerts as a `[THRESHOLD ALERTS]` section in the digest prompt would close this loop. This is a 10-line change to `digest/route.ts`.

### Synthesis 5 — Russian oblast air raid coverage (backlog 5.7) is the highest-value missing bilateral layer

The dashboard shows Ukrainian alarms but not Russian ones. Belgorod, Kursk, Bryansk, and Voronezh oblasts have had hundreds of Ukrainian cross-border operations since 2023. An OSINT operator watching the UA-RU front has no OSIRIS visibility into Russian responses to Ukrainian drone operations. Backlog 5.7 is already groomed with a concrete implementation plan. Given that the Telegram scraping infrastructure exists, the oblast centroid data is straightforward, and the channels (`@bazabazon`, `@mashnews`, `@shot_shot`) are identified — this feature has the highest analyst value per implementation effort of any remaining backlog item. However, the THERMAL-AOI-CLASSIFIER.md research notes these three channels showed "no military content in recent posts" as of June 7, 2026. Re-verify channel scrapability before committing to this approach; alternative channels `@Molyar_Belgorod`, `@kursk_today` are more likely to carry oblast-specific alert content.

---

*This document was generated by BA audit on 2026-06-07. It should be reviewed against the current codebase state before each dev session, as shipped changes may resolve findings. File path: `/home/renegadev/osiris/docs/FEATURE-REVIEW-BA.md`.*
