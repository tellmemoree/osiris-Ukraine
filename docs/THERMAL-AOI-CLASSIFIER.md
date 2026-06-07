# Thermal AOI Classifier — Research & Refinement Spec
**Status:** Draft · Groomed 2026-06-07  
**Feeds into:** backlog item 2.3b — Strike/advance classifier refinement  
**Companion code:** `src/app/api/strategic-thermal/route.ts`, `src/app/api/captures/route.ts`

---

## 1. Research summary — source catalog

### 1.1 Ukrainian sources (strike-claim side)

| Channel | Handle | Focus | Format | Strike signal quality |
|---|---|---|---|---|
| Serhiy Sternenko | `@ssternenko` | UA strikes on RU infrastructure; fundraising | Celebratory single-target posts, donation links | **High** — names exact target, city, fire area, tank count |
| ҐРУНТ Media | `@gruntmedia` | Balanced UA/RU news | Bulletin, bullet-point | **Medium** — reports both directions, names targets |
| InformNapalm | `@informnapalm` | OSINT/CYBINT verification | Geolocated, satellite/thermal imagery, precise coordinates | **Highest** — provides lat/lng, thermal signatures |
| Zelenskyy Official | `@V_Zelenskiy_official` | Strategic confirmations | Conversational, confirmed after fact | **High authority** — names strike package, range, objectives |
| ДвіЩ | `@dvish_since2019` | Combat unit ops, FPV drone videos | Short clips + captions | **Low for AOI** — tactical ground, rarely hits FIRMS-relevant sites |

**Key ssternenko patterns** (from posts 59032–59092, June 2026):
- Posts name target explicitly in opening line: `"Нафтобаза в Усть-Лабінську"`, `"Корвет «Бойкий»"`, `"Зуївська ТЕЦ в Зугресі"`
- Damage specifics common: fire area m², tank count, fuel volume (m³)
- Location always named with oblast: `"Усть-Лабінськ (Кубань)"`, `"Кронштадт"`, `"Сімферопольський район Криму"`
- No weapon attribution when SSO operation; drone type named for unit ops

**Key informnapalm patterns**:
- Provides geolocation coordinates directly
- Thermal/satellite cross-reference built in
- Posts FIRMS-corroborating satellite imagery on confirmed hits
- Labels each strike with confidence: "confirmed by thermal" vs "claimed"

---

### 1.2 Russian sources (confirmation / denial side)

| Channel | Handle | Focus | Strike confirmation stance | Reliability for AOI cross-ref |
|---|---|---|---|---|
| WarGonzo (Semyon Pegov) | `@wargonzo` | Front-line war correspondent | **Confirms fires, claims interceptions** — most honest of RU milbloggers | **High** — acknowledges damage while adding Russian spin |
| Colonel Cassad (Boris Rozhin) | `@colonelcassad` | Pro-RU military analysis | Documents Russian strikes on UA with weapon types; rarely denies UA hits | **Medium** — systematic but one-sided |
| Readovka | `@readovkanews` | Pro-RU news outlet | Confirms infrastructure damage from UA side but minimises scope | **Medium** — will confirm bridge/road damage |
| Russian MoD | `@mod_russia` | Official Russian MoD | Reports interception counts; **never confirms damage** | **Low for hits** — good for drone-count cross-reference only |
| Baza | `@bazabazon` | Russian breaking news | Does not cover military events in recent posts | **Not useful currently** |
| Mash | `@mashnews` | Russian breaking news | Channel header only accessible; no military content visible | **Not useful currently** |
| Shot | `@shot_shot` | Russian breaking news | Lifestyle/entertainment focus in recent posts | **Not useful currently** |
| Grey Zone | `@grey_zone` | Wagner / PMC | Africa ops focus; not UA-RU strike relevant | **Not useful** |

**WarGonzo key pattern** (confirmed June 5–6, 2026 strike):  
> "144 drones intercepted over the region; fires reported near Bolshaya Izhora; damage to MoD facility in Lomonosov District requiring partial evacuation; 4 civilians injured"  
— Confirms fire + evacuation while claiming 144 intercepts. FIRMS would resolve actual hit extent.

**Russian MoD key pattern**:  
> "339 Ukrainian drones intercepted/destroyed across multiple Russian regions (7:00–20:00)"  
— Gives total drone counts; useful to cross-reference against UA claims of how many got through.

---

## 2. Cross-comparison examples (bilateral ground truth)

### 2.1 Kronstadt naval base — June 5–6, 2026

| Metric | UA claim | RU claim | FIRMS potential |
|---|---|---|---|
| Target | Corvette Boiky; naval shipyard dry dock | "144 drones intercepted"; fires near Bolshaya Izhora; partial MoD facility evacuation | Kronstadt: ~60.0°N, 29.8°E — **within BBOX** |
| Damage | "Everything burned out after 3+ hours" (InformNapalm) | "Partial evacuation, 4 civilians injured" (WarGonzo) | Naval infrastructure fire → expect FRP ≥ 15 MW if main dock hit |
| Source convergence | ssternenko, InformNapalm, Zelenskyy | WarGonzo | Cross-reference window: 12 h after UA announcement |
| AOI classification | **BILATERAL HIGH** — both sides confirm fire | | |

**Gap:** Kronstadt is NOT in the current SITES list. Needs to be added.

---

### 2.2 Ust-Labinsk oil depot — June 5–6, 2026

| Metric | UA claim | RU claim | FIRMS potential |
|---|---|---|---|
| Target | Ust-Labinsk oil depot, Krasnodar Krai | "Oil infrastructure in Krasnodar region" (WarGonzo) | ~45.22°N, 39.71°E — **within BBOX** |
| Damage | 5,000 m² fire; 28 tanks; 15,000 m³ fuel (AI-92/AI-95 + diesel) | Fire confirmed; scope not quantified | High FRP expected (petroleum products) |
| Source convergence | ssternenko (detailed), Zelenskyy (mentioned as "oil storage facility ~500 km from Ukraine") | WarGonzo | |
| AOI classification | **BILATERAL HIGH** | | |

**Gap:** Ust-Labinsk is NOT in SITES. `oil-krasnodar` (45.07/39.03) is nearby but wrong target — Ust-Labinsk is a distinct facility 15 km NE.

---

### 2.3 Chongar bridge — June 2026

| Metric | UA claim | RU claim | FIRMS potential |
|---|---|---|---|
| Target | Chongar bridge (Crimea crossing) | Bridge deck damaged, "Dzhankoy" checkpoint closed (Readovka confirms) | ~45.83°N, 34.65°E — within BBOX |
| Damage | "Traffic blocked" (ssternenko) | "Redirected to Armyansk/Perekop checkpoints" | Low FRP (bridge, not fuel); FIRMS not diagnostic |
| Source convergence | ssternenko | Readovka | Non-thermal target — FIRMS won't help |
| AOI classification | **BILATERAL, NON-THERMAL** — omit from AOI, add to future Logistics Disruption layer |

---

### 2.4 Zuivska Thermal Power Station (Zugres, Donetsk) — June 2026

| Metric | UA claim | FIRMS potential |
|---|---|---|
| Target | Zuivska TPS (Теплоелектростанція), Zugres | ~48.01°N, 38.51°E — **within BBOX** |
| Damage | Fire confirmed; aerial imagery | Power plant fire → FRP ≥ 20 MW expected |
| Source | ssternenko, ҐРУНТ | |
| Gap | NOT in SITES | |

---

### 2.5 Semykolodiaznaya oil depot (Crimea) — June 2026

| Metric | UA claim | FIRMS potential |
|---|---|---|
| Target | Naftobaza "Semikolodyeznska", Yedy-Koyu, Crimea | ~45.2°N, 33.78°E — within BBOX |
| Damage | Fire confirmed (satellite imagery, ssternenko) | Petroleum fire → FRP ≥ 15 MW |
| Gap | NOT in SITES | |

---

## 3. Current classifier analysis

### 3.1 STRIKE_TERMS (line 129–135)

```
'strike', 'struck', 'explos', 'blast', 'drone', 'missile', 'shahed', 'uav', 'destroyed',
'burn', 'ablaze', 'depot', 'refiner', 'ammunition', 'shelling', 'detonat', 'wildfire',
'удар', 'вибух', 'дрон', 'ракет', 'шахед', 'бпла', 'знищ', 'пожеж', 'горить', 'склад',
'нпз', 'нафтоба', 'обстріл', 'влучан', 'детонац', 'приліт',
'взрыв', 'уничтож', 'пожар', 'горит', 'нефтеба', 'обстрел', 'прилет',
```

**False positive generators (confirmed from post analysis):**
| Term | Why it fires falsely | Fix |
|---|---|---|
| `'wildfire'` | Matches wildfire articles geolocated near BBOX sites | **Remove** — FIRMS already identifies fires; wildfire news is noise |
| `'destroyed'` | "Destroyed documents", "city destroyed in 2014" (historical) | Acceptable — ADVANCE_TERMS handles most; historical-year guard in captures route should mirror here |
| `'burn'` / `'горить'` | Forest fire season articles, industrial accidents unrelated to war | **Mitigate** — require co-occurrence with target-type term OR FRP > threshold |
| `'drone'` / `'дрон'` | Air defense intercept reports ("UA drones intercepted over Kyiv") — the SITE is in UA but the event is a Russian attack, not a UA strike | Acceptable for current use case — these ARE relevant to AOI monitoring |
| `'знищ'` | "знищено документів" (documents destroyed), tactical gear loss reports | Low risk — usually acceptable; `isTerritorialAdvance` handles most |

**Missing terms (from real strike posts):**
| Term | Source | What it covers |
|---|---|---|
| `'нафтобаза'` | ssternenko (explicit in many posts) | Oil depot — already covered by `'нафтоба'` stem ✓ |
| `'нафтосховищ'` | Compound: "oil storage" | Oil tank farm — NOT covered |
| `'корвет'` / `'корабль'` / `'судно'` | ssternenko naval posts | Naval vessel strike |
| `'верф'` / `'верфи'` / `'shipyard'` | InformNapalm | Shipyard/drydock |
| `'арсенал'` / `'arsenal'` | dvish_since2019 | Ammo arsenal |
| `'атакован'` / `'атаковано'` | Both sides | Generic "attacked" (RU/UA) |
| `'підпалив'` / `'підпалено'` | UA: "set on fire" | Incendiary attack result |
| `'прилетіло'` | Informal UA: "it arrived/hit" | Colloquial strike confirmation |
| `'теплоелектростанц'` / `'тец'` | ssternenko | Thermal power station |
| `'злетів з'` / `'злетів'` | NOT useful — departure, not strike | |
| `'ammunition depot'` / `'ammo depot'` | EN coverage | Ammo storage — covered by `'ammunition'` ✓ |
| `'oil terminal'` / `'fuel depot'` | EN coverage | Petroleum — `'depot'` covers ✓ |
| `'naval base'` / `'naval facility'` | EN for Kronstadt-type events | Naval infrastructure |

---

### 3.2 ADVANCE_TERMS (line 148–152)

```
'liberat', 'recaptur', 'took control', 'under control', 'gained control', 'overran',
'освобод', 'под контроль', 'захват', 'продвин',    // RU
'звільн', 'під контроль', 'захопл', 'просун',      // UA
```

**Confirmed false-positive-causing patterns NOT covered:**
| Missing term | Language | Example triggering article | Fix |
|---|---|---|---|
| `'встановлено контроль'` / `'встановив контроль'` | UA | "Ukrainian forces established control over Shevchenko" | Add `'встановив контрол'` |
| `'зайняли'` / `'зайняв'` | UA | "Russian forces took [settlement]" | Add `'зайняли'` |
| `'населений пункт'` | UA | "settlement captured" | **Do NOT add** — too generic; co-occurs in strike reports ("strike near settlement X") |
| `'відбили'` / `'відбито'` | UA | "Repelled attack, regained" | Consider adding `'відбили'` |
| `'відступили'` / `'відступ'` | UA/RU | Retreat articles often geolocalise near front where FIRMS fires are frontline | **Caution** — retreat articles are NOT strikes but shouldn't be re-labelled as advances either; handle as third excluded class |
| `'взяли под контроль'` | RU | "took under control" — not caught by `'под контроль'` alone | Already caught ✓ (substring match) |
| `'прорвали'` | RU | "broke through the line" | Consider adding |
| `'штурм'` / `'штурмуют'` | RU | "assault on settlement" — NOT a strike on infrastructure | Add `'штурм'` |
| `'оборону'` + `'прорвали'` | RU | "broke through defences" | Add `'прорвали оборону'` or just `'прорвали'` |

---

## 4. Recommended SITES additions

Based on bilateral-confirmed strikes from section 2:

| id | name | category | lat | lng | Source for coords |
|---|---|---|---|---|---|
| `af-kronstadt` | Kronstadt naval base (Baltic)` | `airfield` → rename to new `naval` category | 59.99 | 29.76 | ssternenko/InformNapalm/WarGonzo |
| `oil-ust-labinsk` | Ust-Labinsk oil depot (Kuban) | `oil` | 45.22 | 39.71 | ssternenko 59055, 59054 |
| `oil-semykolod` | Semykolodiaznaya oil depot (Crimea) | `oil` | 45.20 | 33.78 | ssternenko 59085/92 |
| `pwr-zugres` | Zuivska TPS — Zugres (Donetsk) | new: `power` | 48.01 | 38.51 | ssternenko 59085/92; ҐРУНТ |
| `naval-novoross-port` | Novorossiysk naval port | `naval` (new cat) | 44.74 | 37.77 | Overlaps `oil-novorossiysk`; split by function |
| `naval-berdyansk-port` | Berdyansk port (occupied) | `naval` | 46.75 | 36.80 | ssternenko 59039 sea drones |
| `naval-mariupol-port` | Mariupol port (occupied) | `naval` | 47.10 | 37.57 | ssternenko 59039, 59067 |
| `ammo-leningrad-arsenal` | Leningrad Oblast naval arsenal (ammo) | new: `ammo` | 59.90 | 29.60 | ssternenko 59054, 59055 |

**New category proposal:** `naval` and `power` alongside existing `airfield`, `rail`, `logistics`, `oil`.

---

## 5. Recommended channel additions to news route

The news route (`/api/news`) fetches from `UA_THREAT_CHANNELS`. Add:

### For bilateral strike confirmation (highest priority):
- `ssternenko` — detailed UA strike claims with explicit targets; high signal-to-noise
- `informnapalm` — OSINT-verified, thermal-corroborated; reduces false positives downstream
- `wargonzo` — Russian correspondent who **confirms fires** while adding RU spin; enables bilateral matching

### For Russian-perspective strike reporting (medium priority):
- `colonelcassad` — systematic documentation of Russian strikes on UA with weapon types (Geran, UMPC, Kalibr); good for the captures layer
- `readovkanews` — confirms infrastructure damage from UA strikes on RU; low volume of false positives

### Do NOT add yet:
- `bazabazon`, `mashnews`, `shot_shot` — currently not publishing military content in accessible web preview
- `grey_zone` — Wagner/Africa focus, not Ukraine theater relevant

---

## 6. Bilateral confidence architecture (proposed for 2.3b)

### Current state
AOIs have a single `confidence: 'low' | 'med' | 'high' | 'news'` field driven only by FRP + fire count. Source side (`side: 'ua' | 'ru'`) exists on news items but is not surfaced in the AOI.

### Proposed addition
Add `bilateral: boolean` flag to news AOIs, set `true` when the merged `sources[]` array contains at least one `side: 'ua'` AND one `side: 'ru'` contributor for the same cell.

**Upgrade rule:**
```
bilateral = true  →  confidence bumped by one tier (low→med, med→high)
bilateral = true + FIRMS hit  →  confidence = 'high' regardless of FRP
```

**Popup display change:**
```
Before: "Strike lead · med confidence · 2 fires (FRP 8 MW)"
After:  "Strike lead · HIGH confidence · UA + RU sources · 2 fires (FRP 8 MW)"
```

**Implementation touch point:** `strategic-thermal/route.ts` lines 240–246 (NewsAoi construction) and the OsirisMap popup renderer.

---

## 7. Classifier refinement — concrete diff

### STRIKE_TERMS — add:
```ts
// Naval / shipyard
'корвет', 'фрегат', 'корабл', 'судно', 'верф', 'shipyard', 'naval base', 'naval facilit',
// Power infrastructure
'теплоелектростанц', 'електростанц', 'тец ', 'power station', 'power plant',
// Oil storage variants
'нафтосховищ', 'oil terminal',
// Arsenal / ammo
'арсенал', 'arsenal',
// Attack confirmation verbs
'атаковано', 'атакован', 'підпален', 'прилетіло',
```

### STRIKE_TERMS — remove:
```ts
'wildfire',  // creates false positives from natural fire season news
```

### ADVANCE_TERMS — add:
```ts
// UA: established control, took settlement, repelled
'встановив контрол', 'встановлено контрол', 'зайняли', 'зайняв', 'відбили',
// RU: assault, breakthrough
'штурмують', 'штурм ', 'прорвали', 'наступают',
// EN: additional control-change language
'overrun', 'fallen to', 'fell to', 'seized by', 'stormed',
```

### Historical false positive guard (mirrors captures route)
Add to `isStrikeRelated` — skip articles where title matches:
```ts
const DIGEST_TITLE_RE = /^(главное за|сводка|зведення|дайджест|итоги дня|підсумки|обзор за|за сутки|за добу|morning brief|evening brief|daily (round|update|brief|wrap))/i;
const HISTORICAL_YEAR_RE = /\b(201[4-9]|202[01])\b/;
```
Apply both guards as exclusions before STRIKE_TERMS matching (same pattern already in captures route).

---

## 8. BBOX extension consideration

Current: `{ latMin: 43, latMax: 71, lngMin: 19, lngMax: 66 }`

**Kronstadt** (60.0°N, 29.8°E): within BBOX ✓  
**Leningrad Oblast arsenal** (~59.9°N, 29.6°E): within BBOX ✓  
**Tyumen refinery** (~57.2°N, 68.3°E): lngMax 66 < 68.3 — **outside bbox**  
→ Extend `lngMax` to 70 to cover Ural-region targets if desired. Risk: more non-war FIRMS fires included; FRP filter compensates.

**Recommendation:** extend `lngMax: 66 → 70` to capture Ural refineries. Net FIRMS fire load increase is modest (flat steppe, few industrial fires).

---

## 9. Recommended sequencing for 2.3b implementation

1. **Add channels to news route** — ssternenko, informnapalm, wargonzo (highest ROI; improves all downstream consumers)
2. **Update STRIKE_TERMS / ADVANCE_TERMS** per section 7 diff
3. **Add SITES** from section 4 table
4. **Add `bilateral` flag** to NewsAoi and bump popup display
5. **Extend BBOX lngMax** to 70 (optional, low risk)
6. **Re-expose layers in LayerPanel** — un-comment the two lines in `LAYER_GROUPS` (UA WAR section)
7. Smoke-test with `?force=1` cache bust; verify bilateral matches appear for Kronstadt/Ust-Labinsk cells

---

*Sources researched: @ssternenko (posts 59032–59092), @gruntmedia, @informnapalm, @V_Zelenskiy_official, @dvish_since2019, @wargonzo, @mod_russia, @colonelcassad, @readovkanews, @bazabazon, @mashnews, @shot_shot, @grey_zone — June 7, 2026*
