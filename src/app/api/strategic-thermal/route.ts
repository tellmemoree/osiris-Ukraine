import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * OSIRIS — Strategic Thermal AOIs.
 *
 * Cross-references NASA FIRMS active-fire detections (keyless 24h global CSV,
 * same source as /api/fires) against points of interest, surfacing fires that
 * coincide with something we care about — a possible strike/incident signal:
 *   1. Curated RU strategic AIRFIELDS (strategic-aviation + frontline-relevant).
 *   2. RU / occupied RAIL & LOGISTICS hubs.
 *   3. OIL DEPOTS / REFINERIES (frequent strike targets).
 *   4. Locations NAMED IN NEWS (geolocated by /api/news), corroborated by a fire.
 *
 * Sites are always returned (monitored markers, `hit` flips true when a fire is
 * within range); news entries are returned ONLY when a fire corroborates them.
 * This is a heuristic — a thermal hit is not proof of a strike (wildfires, flares,
 * industrial heat all trip FIRMS). Treat as a lead, verify before acting.
 */

type Category = 'airfield' | 'rail' | 'logistics' | 'oil' | 'naval' | 'power' | 'ammo' | 'news';
interface Site { id: string; name: string; category: Exclude<Category, 'news'>; lat: number; lng: number; }

// Theater bounding box — western RU + Ukraine + occupied + Crimea + Kola (Olenya).
const BBOX = { latMin: 43, latMax: 71, lngMin: 19, lngMax: 66 };
const SITE_RADIUS_KM = 12;   // airfields/yards sprawl; be inclusive
const NEWS_RADIUS_KM = 15;   // news coords are city-level (and jittered)
const FIRE_ACTIVE_MS = 12 * 60 * 60 * 1000;  // fires older than 12h don't sustain a "hit"

const SITES: Site[] = [
  // ── Strategic / frontline airfields ──
  { id: 'af-engels', name: 'Engels-2 (bomber base)', category: 'airfield', lat: 51.48, lng: 46.19 },
  { id: 'af-dyagilevo', name: 'Dyagilevo (Ryazan)', category: 'airfield', lat: 54.64, lng: 39.57 },
  { id: 'af-morozovsk', name: 'Morozovsk', category: 'airfield', lat: 48.31, lng: 41.79 },
  { id: 'af-millerovo', name: 'Millerovo', category: 'airfield', lat: 48.95, lng: 40.30 },
  { id: 'af-yeysk', name: 'Yeysk', category: 'airfield', lat: 46.68, lng: 38.21 },
  { id: 'af-primorsko', name: 'Primorsko-Akhtarsk', category: 'airfield', lat: 46.05, lng: 38.15 },
  { id: 'af-akhtubinsk', name: 'Akhtubinsk', category: 'airfield', lat: 48.18, lng: 46.27 },
  { id: 'af-olenya', name: 'Olenya (Murmansk)', category: 'airfield', lat: 68.15, lng: 33.46 },
  { id: 'af-saky', name: 'Saky (Crimea)', category: 'airfield', lat: 45.09, lng: 33.60 },
  { id: 'af-belbek', name: 'Belbek (Sevastopol)', category: 'airfield', lat: 44.69, lng: 33.57 },
  { id: 'af-taganrog', name: 'Taganrog', category: 'airfield', lat: 47.20, lng: 38.85 },
  { id: 'af-kursk', name: 'Kursk-Vostochny', category: 'airfield', lat: 51.75, lng: 36.30 },
  { id: 'af-berdyansk', name: 'Berdyansk (occupied)', category: 'airfield', lat: 46.82, lng: 36.75 },
  { id: 'af-shaykovka', name: 'Shaykovka (Tu-22M3 base, Kaluga)', category: 'airfield', lat: 54.23, lng: 34.37 },
  { id: 'af-pskov', name: 'Pskov/Kresty (Il-76 transport base)', category: 'airfield', lat: 57.78, lng: 28.40 },
  { id: 'af-marinovka', name: 'Marinovka (Su-34/Su-24 base, Volgograd)', category: 'airfield', lat: 48.64, lng: 43.79 },
  { id: 'af-lipetsk', name: 'Lipetsk-2 (Su-27/Su-30 combat training)', category: 'airfield', lat: 52.63, lng: 39.44 },
  { id: 'af-kazan-kapo', name: 'Kazan KAPO (Tu-160/Tu-22M3 production & repair)', category: 'airfield', lat: 55.86, lng: 49.12 },
  { id: 'af-seshcha', name: 'Seshcha (An-124 heavy-lift transport, Bryansk)', category: 'airfield', lat: 53.72, lng: 33.34 },
  // ── Rail hubs / marshalling yards ──
  { id: 'rl-rostov', name: 'Rostov-on-Don (rail hub)', category: 'rail', lat: 47.24, lng: 39.71 },
  { id: 'rl-bataysk', name: 'Bataysk marshalling yard', category: 'rail', lat: 47.14, lng: 39.75 },
  { id: 'rl-likhaya', name: 'Likhaya junction', category: 'rail', lat: 48.12, lng: 40.18 },
  { id: 'rl-voronezh', name: 'Voronezh (rail)', category: 'rail', lat: 51.66, lng: 39.20 },
  { id: 'rl-bryansk', name: 'Bryansk (rail)', category: 'rail', lat: 53.24, lng: 34.36 },
  { id: 'rl-tikhoretsk', name: 'Tikhoretsk junction', category: 'rail', lat: 45.86, lng: 40.13 },
  { id: 'rl-dzhankoi', name: 'Dzhankoi rail hub (Crimea)', category: 'rail', lat: 45.71, lng: 34.39 },
  { id: 'rl-armyansk', name: 'Armyansk (Crimea N. rail)', category: 'rail', lat: 46.11, lng: 33.69 },
  // ── Occupied logistics nodes ──
  { id: 'lg-melitopol', name: 'Melitopol (logistics hub)', category: 'logistics', lat: 46.84, lng: 35.37 },
  { id: 'lg-tokmak', name: 'Tokmak (occupied)', category: 'logistics', lat: 47.25, lng: 35.71 },
  { id: 'lg-volnovakha', name: 'Volnovakha (rail/logistics)', category: 'logistics', lat: 47.60, lng: 37.50 },
  { id: 'lg-mariupol', name: 'Mariupol (port/rail)', category: 'logistics', lat: 47.10, lng: 37.55 },
  { id: 'lg-belgorod', name: 'Belgorod (staging)', category: 'logistics', lat: 50.60, lng: 36.59 },
  // ── Oil depots / refineries (frequent strike targets) ──
  { id: 'oil-novorossiysk', name: 'Novorossiysk (Sheskharis oil terminal)', category: 'oil', lat: 44.70, lng: 37.80 },
  { id: 'oil-tuapse', name: 'Tuapse refinery', category: 'oil', lat: 44.10, lng: 39.08 },
  { id: 'oil-ustluga', name: 'Ust-Luga oil terminal (Baltic)', category: 'oil', lat: 59.67, lng: 28.27 },
  { id: 'oil-ryazan', name: 'Ryazan refinery', category: 'oil', lat: 54.61, lng: 39.69 },
  { id: 'oil-volgograd', name: 'Volgograd (Lukoil) refinery', category: 'oil', lat: 48.62, lng: 44.42 },
  { id: 'oil-novoshakhtinsk', name: 'Novoshakhtinsk refinery', category: 'oil', lat: 47.78, lng: 39.93 },
  { id: 'oil-slavyansk', name: 'Slavyansk-na-Kubani refinery', category: 'oil', lat: 45.26, lng: 38.13 },
  { id: 'oil-ilsky', name: 'Ilsky refinery', category: 'oil', lat: 44.84, lng: 38.58 },
  { id: 'oil-afipsky', name: 'Afipsky refinery', category: 'oil', lat: 44.90, lng: 38.84 },
  { id: 'oil-krasnodar', name: 'Krasnodar refinery', category: 'oil', lat: 45.07, lng: 39.03 },
  { id: 'oil-saratov', name: 'Saratov refinery', category: 'oil', lat: 51.50, lng: 46.10 },
  { id: 'oil-syzran', name: 'Syzran refinery', category: 'oil', lat: 53.16, lng: 48.47 },
  { id: 'oil-kstovo', name: 'Kstovo refinery (Nizhny Novgorod)', category: 'oil', lat: 56.15, lng: 44.20 },
  { id: 'oil-feodosia', name: 'Feodosia oil terminal (Crimea)', category: 'oil', lat: 45.04, lng: 35.38 },
  // ── Naval ports (occupied + Baltic) ──
  { id: 'naval-kronstadt', name: 'Kronstadt naval base (Baltic)', category: 'naval', lat: 59.99, lng: 29.76 },
  { id: 'naval-berdyansk', name: 'Berdyansk port (occupied)', category: 'naval', lat: 46.75, lng: 36.80 },
  { id: 'naval-mariupol', name: 'Mariupol port (occupied)', category: 'naval', lat: 47.10, lng: 37.57 },
  { id: 'naval-novorossiysk', name: 'Novorossiysk naval base (Black Sea Fleet HQ)', category: 'naval', lat: 44.72, lng: 37.83 },
  { id: 'naval-kerch-zaliv', name: 'Zaliv shipyard Kerch (corvette construction, Crimea)', category: 'naval', lat: 45.26, lng: 36.42 },
  // ── Power infrastructure ──
  { id: 'pwr-zugres', name: 'Zuivska TPS — Zugres (Donetsk)', category: 'power', lat: 48.01, lng: 38.51 },
  { id: 'pwr-simferopol-tes', name: 'Simferopol TES (Crimea CHP)', category: 'power', lat: 44.98, lng: 34.07 },
  // ── Oil storage (bilateral-confirmed strikes) ──
  { id: 'oil-ust-labinsk', name: 'Ust-Labinsk oil depot (Kuban)', category: 'oil', lat: 45.22, lng: 39.71 },
  { id: 'oil-semykolod', name: 'Semykolodiaznaya oil depot (Crimea)', category: 'oil', lat: 45.20, lng: 33.78 },
  // ── Ammunition / arsenal ──
  { id: 'ammo-leningrad-arsenal', name: 'Leningrad Oblast naval arsenal', category: 'ammo', lat: 59.90, lng: 29.60 },
  { id: 'ammo-tambov', name: 'Tambov gunpowder plant / Kotovsk (propellant, artillery powder)', category: 'ammo', lat: 52.58, lng: 41.52 },
  { id: 'ammo-bryansk-chem', name: 'Bryansk Chemical Plant / Seltso (rocket propellant, phosphorous)', category: 'ammo', lat: 53.37, lng: 34.10 },
  // ── Defense-industrial (direct strike targets, June 2026) ──
  { id: 'ind-arsenal-spb', name: 'Arsenal defense plant (St. Petersburg)', category: 'ammo', lat: 59.96, lng: 30.37 },
  { id: 'ind-vniir-cheboksary', name: 'VNIIR-Progress (Cheboksary — drives/hydraulics for artillery/Iskander)', category: 'ammo', lat: 56.14, lng: 47.22 },
  { id: 'ind-alabuga', name: 'Alabuga SEZ / Yelabuga (Shahed/Geran-2 drone factory, Tatarstan)', category: 'ammo', lat: 55.84, lng: 52.05 },
  { id: 'ind-kupol-izhevsk', name: 'Kupol plant Izhevsk (Tor SAM + Garpia-A1 drone production)', category: 'ammo', lat: 56.84, lng: 53.18 },
  // ── Oil / energy (new or previously unnamed targets) ──
  { id: 'oil-kuibyshev-samara', name: 'Kuibyshev refinery (Samara, Rosneft)', category: 'oil', lat: 53.21, lng: 50.15 },
  { id: 'oil-nps-vtoroye', name: 'NPS Vtoroye — Transneft pipeline (Vladimir Oblast)', category: 'oil', lat: 56.40, lng: 41.85 },
  { id: 'oil-kizlyurt-gas', name: 'Gas infrastructure (Kizlyurt, Dagestan)', category: 'oil', lat: 43.21, lng: 46.87 },
  { id: 'oil-yaroslavl', name: 'Slavneft-YANOS refinery (Yaroslavl, 15M t/yr)', category: 'oil', lat: 57.55, lng: 39.81 },
  { id: 'oil-kapotnya', name: 'Kapotnya refinery (Moscow, 40% of region fuel)', category: 'oil', lat: 55.64, lng: 37.80 },
  { id: 'oil-ufa', name: 'Bashneft-UNPZ / Novoil refinery complex (Ufa, Bashkortostan)', category: 'oil', lat: 54.86, lng: 56.09 },
  // ── Petrochemical / military-industrial (struck June 2026) ──
  { id: 'ind-tolyattikauchuk', name: 'Tolyattikauchuk (Samara Oblast — synthetic rubber for armour/aviation)', category: 'oil', lat: 53.50, lng: 49.38 },
  { id: 'ind-nizhnekamskneftekhim', name: 'Nizhnekamskneftekhim (Tatarstan — polymers/rubber for VPK)', category: 'oil', lat: 55.64, lng: 51.55 },
  // ── Nizhnekamsk refinery complex (struck June 2026, confirmed by UA General Staff) ──
  { id: 'oil-taneco-nizhnekamsk', name: 'TANECO refinery (Nizhnekamsk, Tatarstan — 15M t/yr, TAIF Group)', category: 'oil', lat: 55.77, lng: 51.88 },
  { id: 'oil-taifnk-nizhnekamsk', name: 'TAIF-NK refinery (Nizhnekamsk, Tatarstan — naphtha/fuel oil)', category: 'oil', lat: 55.64, lng: 51.82 },
];

interface Fire { lat: number; lng: number; frp: number; brightness: number; date: string; time: string; ts: number; }
interface NewsItem { title?: string; description?: string; source?: string; side?: string; link?: string; coords?: [number, number] | null; coords_default?: boolean; places?: [number, number][]; hasVideo?: boolean; }

// Equirectangular distance (km) — accurate enough at this scale, cheap in a hot loop.
function distKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = aLat - bLat;
  const dLng = (aLng - bLng) * Math.cos(((aLat + bLat) / 2) * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng) * 111.32;
}

async function fetchTheaterFires(): Promise<Fire[]> {
  const sources = [
    'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv',
    'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv',
  ];
  for (const url of sources) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'OSIRIS-Intelligence-Platform/3.5' } });
      if (!res.ok) continue;
      const text = await res.text();
      const lines = text.trim().split('\n');
      if (lines.length < 2 || !lines[0].includes('latitude')) continue;
      const h = lines[0].split(',');
      const li = h.indexOf('latitude'), gi = h.indexOf('longitude');
      const bi = h.indexOf('bright_ti4') !== -1 ? h.indexOf('bright_ti4') : h.indexOf('brightness');
      const di = h.indexOf('acq_date'), ti = h.indexOf('acq_time'), fi = h.indexOf('frp');
      const fires: Fire[] = [];
      for (let i = 1; i < lines.length && fires.length < 8000; i++) {
        const c = lines[i].split(',');
        const lat = parseFloat(c[li]), lng = parseFloat(c[gi]);
        if (isNaN(lat) || isNaN(lng)) continue;
        if (lat < BBOX.latMin || lat > BBOX.latMax || lng < BBOX.lngMin || lng > BBOX.lngMax) continue;
        const acqTime = (c[ti] || '0000').padStart(4, '0');
        const ts = new Date(`${c[di]}T${acqTime.slice(0, 2)}:${acqTime.slice(2, 4)}:00Z`).getTime();
        fires.push({ lat, lng, frp: parseFloat(c[fi]) || 0, brightness: parseFloat(c[bi]) || 0, date: c[di] || '', time: c[ti] || '', ts: isNaN(ts) ? Date.now() : ts });
      }
      const cutoff = Date.now() - FIRE_ACTIVE_MS;
      return fires.filter(f => f.ts >= cutoff);
    } catch { continue; }
  }
  return [];
}

async function fetchNews(req: Request): Promise<NewsItem[]> {
  try {
    const res = await fetch(new URL('/api/news', req.url), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const d = await res.json();
    return Array.isArray(d.news) ? d.news : [];
  } catch { return []; }
}

// A news→fire match only counts as a thermal lead when the article is actually about a
// strike/fire/explosion — the main false-positive filter (a sports story geolocated near
// a wildfire shouldn't read as a strike). Multilingual EN/UA/RU stems.
const STRIKE_TERMS = [
  'strike', 'struck', 'explos', 'blast', 'drone', 'missile', 'shahed', 'uav', 'destroyed',
  'burn', 'ablaze', 'depot', 'refiner', 'ammunition', 'shelling', 'detonat', 'підрив',
  'shipyard', 'naval base', 'naval facilit', 'arsenal', 'power station', 'power plant', 'oil terminal',
  'удар', 'вибух', 'дрон', 'ракет', 'шахед', 'бпла', 'знищ', 'пожеж', 'горить', 'склад',
  'нпз', 'нафтоба', 'нафтосховищ', 'обстріл', 'влучан', 'детонац', 'приліт', 'прилетіло',
  'теплоелектростанц', 'електростанц', 'арсенал', 'атаковано', 'підпален',
  'взрыв', 'уничтож', 'пожар', 'горит', 'нефтеба', 'обстрел', 'прилет',
  'корвет', 'фрегат', 'корабл', 'верф', 'атакован',
  'теплоэлектростанц', 'электростанц',
  'хлопк',  // Russian informal "bang" — euphemism used by RU state/milblogs for explosions
];

const DIGEST_TITLE_RE = /^(главное за|сводка|зведення|дайджест|итоги дня|підсумки|обзор за|за сутки|за добу|вчора та у ніч|вчора і в ніч|за минулу добу|за минулу ніч|morning brief|evening brief|daily (round|update|brief|wrap))/i;
const HISTORICAL_YEAR_RE = /\b(201[4-9]|202[0-4])\b/;

function isStrikeRelated(item: NewsItem): boolean {
  const title = (item.title || '').toLowerCase();
  if (DIGEST_TITLE_RE.test(title)) return false;
  if (HISTORICAL_YEAR_RE.test(title)) return false;
  const t = `${title} ${(item.description || '').toLowerCase()}`;
  return STRIKE_TERMS.some(w => t.includes(w));
}

// Territorial-control / capture-advance reports ("Russia liberated X", "took
// control of Y") sit in ambient front-line FIRMS heat AND carry combat verbs, so
// they slip past isStrikeRelated as false positives — yet they are NOT strikes on
// strategic targets. Exclude them. PRECISE capture/liberation/control-change stems
// only: deliberately omit bare "occupied"/"наступ" (the latter collides with
// "наступний"/next — see ARCHITECTURE.md) so genuine strike reports ("...depot in
// the occupied Donetsk region") are NOT dropped.
const ADVANCE_TERMS = [
  'liberat', 'recaptur', 'took control', 'under control', 'gained control', 'overran',
  'overrun', 'fallen to', 'fell to', 'seized by', 'stormed',
  'освобод', 'под контроль', 'захват', 'продвин', 'штурм', 'прорвали', 'наступают',
  'звільн', 'під контроль', 'захопл', 'просун',
  'встановив контрол', 'встановлено контрол', 'зайняли', 'зайняв', 'штурмують',
  'відійшли', 'залишили', 'ворог увійшов',
];
function isTerritorialAdvance(item: NewsItem): boolean {
  const t = `${item.title || ''} ${item.description || ''}`.toLowerCase();
  return ADVANCE_TERMS.some(w => t.includes(w));
}

// Air-defense / interception reports ("326 UAVs shot down by ПВО") pass
// isStrikeRelated because they contain drone/UAV terms, yet they report a
// DEFENSIVE interception, not a ground impact on a strategic target. Exclude
// them UNLESS the article also contains ground-impact evidence (explosion, fire,
// hit, damage) that suggests at least one munition got through.
const INTERCEPT_STEMS = [
  'shot down', 'were shot', 'дежурными средствами', 'средствами пво',
  'збили', 'знищили засоба', 'перехват', 'перехоплен',
  'сбит', 'сбиты', 'сбито', 'збит', 'збиті', 'збито',
];
const GROUND_IMPACT_STEMS = [
  'вибух', 'взрыв', 'пожеж', 'пожар', 'горит', 'горить',
  'приліт', 'прилет', 'влучан', 'детонац', 'хлопк',
  'explos', 'blast', 'ablaze', 'burn', 'detonat', 'impact', 'hit',
];
function isInterceptionOnly(item: NewsItem): boolean {
  const t = `${item.title || ''} ${item.description || ''}`.toLowerCase();
  if (!INTERCEPT_STEMS.some(w => t.includes(w))) return false;
  return !GROUND_IMPACT_STEMS.some(w => t.includes(w));
}


// For unconfirmed (no-fire) markers, the article must name a specific infrastructure
// type — not just mention drones/missiles in passing. This filters civilian-incident
// articles and military-exhibition pieces (e.g. "FPV drones at Patriot Park") from
// generating unverified markers without any satellite corroboration.
const STRATEGIC_TARGET_TERMS = [
  // EN
  'refinery', 'oil depot', 'fuel depot', 'ammo depot', 'ammunition depot', 'arms depot',
  'arsenal', 'airfield', 'airbase', 'air base', 'naval facilit', 'shipyard',
  'oil terminal', 'fuel terminal', 'power plant', 'power station', 'substation',
  'marshalling yard', 'rail yard', 'rail hub', 'pipeline', 'storage facility',
  // UA
  'нпз', 'нафтоба', 'нафтосховищ', 'нафтопереробн', 'паливн',
  'аеродром', 'авіабаза', 'авіазавод', 'залізничн вузол', 'сортувальн',
  'електростанц', 'теплоелектростанц', 'підстанц', 'трансформаторн',
  'склад боєприпасів', 'арсенал', 'сховищ пально', 'нафтопровід',
  // RU
  'нефтеба', 'нефтехран', 'нефтезавод',
  'аэродром', 'авиабаза', 'судоремонтн', 'верфь', 'судостроит',
  'сортировочн', 'электростанц', 'теплоэлектростанц', 'подстанц',
  'склад боеприпасов', 'нефтепровод', 'хранилищ топлив',
];
function hasStrategicTarget(item: NewsItem): boolean {
  const t = `${item.title || ''} ${item.description || ''}`.toLowerCase();
  return STRATEGIC_TARGET_TERMS.some(w => t.includes(w));
}

// Weapon type inferred from article text. Priority: specific systems → generic class.
// Returns a short display label or null when nothing matches.
const WEAPON_PATTERNS: [string, string[]][] = [
  ['SHAHED', ['shahed', 'шахед', 'geranium', 'герань', 'lancet', 'ланцет', 'fpv', 'фпв', 'бпла', 'uav', 'drone', 'дрон']],
  ['MISSILE', ['kalibr', 'калибр', 'калібр', 'iskander', 'іскандер', 'искандер', 'kh-10', 'х-10', 'kinzhal', 'кинжал', 'neptune', 'нептун', 'storm shadow', 'scalp', 'atacms', 'cruise missile', 'балістичн', 'ballistic', 'missile', 'ракет']],
  ['GLIDE BOMB', ['kab', 'fab-', 'фаб-', 'glide bomb']],
  ['ARTILLERY', ['обстріл', 'обстрел', 'shelling', 'артилер', 'артиллер', 'снаряд']],
];
function detectWeapon(text: string): string | null {
  const t = text.toLowerCase();
  for (const [label, terms] of WEAPON_PATTERNS) {
    if (terms.some(w => t.includes(w))) return label;
  }
  return null;
}

// Confidence from fire intensity + count. FRP (fire radiative power, MW) is the best single
// discriminator: a struck depot/refinery burns hot (high FRP); a faint farm hotspot is low.
// 'news' = no fire detected — shows as an unverified dim marker (no glow).
function confidenceOf(fireCount: number, maxFrp: number): 'low' | 'med' | 'high' {
  if (maxFrp >= 20 || fireCount >= 4) return 'high';
  if (maxFrp >= 5 || fireCount >= 2) return 'med';
  return 'low';
}
type Confidence = 'low' | 'med' | 'high' | 'news';

// Fires within `radiusKm` of (lat,lng) → aggregate hit stats.
function fireHit(fires: Fire[], lat: number, lng: number, radiusKm: number) {
  let count = 0, maxFrp = 0, latest = '';
  for (const f of fires) {
    if (distKm(lat, lng, f.lat, f.lng) <= radiusKm) {
      count++;
      if (f.frp > maxFrp) maxFrp = f.frp;
      const stamp = `${f.date} ${f.time}`;
      if (stamp > latest) latest = stamp;
    }
  }
  return count > 0 ? { count, maxFrp: Math.round(maxFrp * 10) / 10, latest: latest.trim() } : null;
}

// Extract the most informative sentence from a Telegram post about a strike.
// Scores by: STRATEGIC_TARGET_TERMS (highest) > STRIKE_TERMS > WEAPON_PATTERNS.
// Falls back to the article title. This replaces raw title display in popups so
// "231 дронів збито" headlines don't appear as the report text near a strike target.
function extractBestSnippet(title: string, desc: string): string {
  const sentences = `${title}\n${desc}`.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 12);
  let best = title.slice(0, 140);
  let bestScore = 0;
  for (const s of sentences) {
    const lower = s.toLowerCase();
    let score = 0;
    if (STRATEGIC_TARGET_TERMS.some(w => lower.includes(w))) score += 4;
    if (STRIKE_TERMS.some(w => lower.includes(w))) score += 2;
    for (const [, terms] of WEAPON_PATTERNS) {
      if (terms.some(w => lower.includes(w))) { score += 2; break; }
    }
    if (score > bestScore) { bestScore = score; best = s.slice(0, 140); }
  }
  return best;
}

export async function GET(req: Request) {
  try {
    const [fires, news] = await Promise.all([fetchTheaterFires(), fetchNews(req)]);

    const aois = [];

    // Sites: always emitted; `hit` flips when a fire is within range.
    // sources/videoConfirmed/bilateral/weapon are initialised empty so the news
    // corroboration pass can merge nearby articles into the site dot instead of
    // creating a separate news marker on top of it.
    for (const s of SITES) {
      const h = fireHit(fires, s.lat, s.lng, SITE_RADIUS_KM);
      aois.push({
        id: s.id, category: s.category, name: s.name, lat: s.lat, lng: s.lng,
        hit: !!h, fireCount: h?.count ?? 0, maxFrp: h?.maxFrp ?? 0, latest: h?.latest ?? null,
        confidence: h ? confidenceOf(h.count, h.maxFrp) : null,
        sources: [] as Contributor[], videoConfirmed: false, bilateral: false, weapon: '',
      });
    }

    // News: only STRIKE-RELATED articles that are NOT territorial-advance reports,
    // cross-referenced at EVERY place they name (one article often lists several struck
    // targets — but only places with a corroborating fire within NEWS_RADIUS_KM surface,
    // which is the whole point of the heuristic). Co-located corroborations (same ~0.1°
    // /~11 km cell — different channels, or one strike reported by both sides) MERGE into a
    // single AOI that carries EVERY contributing source, instead of whichever article was
    // processed first silently winning (and mis-attributing) the marker.
    type Contributor = { source?: string; side?: string; link?: string; title?: string; description?: string; hasVideo?: boolean; weapon?: string; snippet?: string };
    type NewsAoi = {
      id: string; category: 'news'; name: string; source?: string; side?: string; link?: string;
      lat: number; lng: number; hit: boolean; fireCount: number; maxFrp: number; latest: string | null;
      confidence: Confidence; sources: Contributor[]; bilateral: boolean; videoConfirmed: boolean; weapon?: string;
    };
    const newsByCell = new Map<string, NewsAoi>();
    for (const n of news) {
      if (!isStrikeRelated(n) || isTerritorialAdvance(n) || isInterceptionOnly(n)) continue;
      // n.places = ALL cities the article names (gazetteer scan of full body) — often
      // includes incidental context cities, not just the actual strike location.
      // n.coords = primary / most-specific location (single best match).
      const isFromPlaces = !!(n.places && n.places.length);
      const candidates = isFromPlaces
        ? n.places
        : (n.coords && !n.coords_default ? [n.coords] : []);
      const seenThisArticle = new Set<string>();
      for (const [lat, lng] of candidates) {
        if (lat < BBOX.latMin || lat > BBOX.latMax || lng < BBOX.lngMin || lng > BBOX.lngMax) continue;
        const key = `${lat.toFixed(1)},${lng.toFixed(1)}`;
        if (seenThisArticle.has(key)) continue; // one article contributes one marker per place
        seenThisArticle.add(key);
        const h = fireHit(fires, lat, lng, NEWS_RADIUS_KM);
        // FRP floor for fire-confirmed news markers. Background fires (agriculture,
        // industrial flare, stubble burn) typically run < 1.5 MW — too weak to confirm
        // a strike. Only fires above this floor count as corroboration.
        const meaningfulHit = h && h.maxFrp >= 1.5 ? h : null;
        // Gate logic differs by coord source:
        //   n.places coords: ALL cities named in the article body, including incidental
        //     context cities. hasStrategicTarget fires on the whole article, not this
        //     specific location, so it cannot disambiguate. Require a meaningful fire
        //     hit. The curated-site proximity merge above already handles the real target
        //     (e.g. "Samara" in a Kuibyshev-refinery article → merges into the site dot).
        //   n.coords (primary location): unconfirmed-strategic markers still allowed for
        //     single-location articles that name a specific strategic infrastructure type.
        if (isFromPlaces) {
          if (!meaningfulHit) continue;
        } else {
          if (!meaningfulHit && !hasStrategicTarget(n)) continue;
        }
        const articleText = `${n.title || ''} ${n.description || ''}`;
        const snippet = extractBestSnippet(n.title || '', n.description || '');
        const contributor: Contributor = { source: n.source, side: n.side, link: n.link, title: n.title?.slice(0, 120), description: n.description?.slice(0, 220), hasVideo: n.hasVideo, weapon: detectWeapon(articleText) ?? undefined, snippet };

        // Corroboration: if this coord falls within a curated site's radius, merge the
        // article into the site AOI instead of creating a separate news dot on top of it.
        const siteAoi = (aois as any[]).find(a => a.category !== 'news' && distKm(lat, lng, a.lat, a.lng) <= SITE_RADIUS_KM);
        if (siteAoi) {
          if (!siteAoi.sources.some((s: any) => s.source === contributor.source && s.title === contributor.title)) {
            siteAoi.sources.push(contributor);
          }
          if (h && !siteAoi.hit) {
            siteAoi.hit = true; siteAoi.fireCount = h.count; siteAoi.maxFrp = h.maxFrp;
            siteAoi.latest = h.latest; siteAoi.confidence = confidenceOf(h.count, h.maxFrp);
          }
          if (contributor.weapon && !siteAoi.weapon) siteAoi.weapon = contributor.weapon;
          if (contributor.hasVideo && !siteAoi.videoConfirmed) siteAoi.videoConfirmed = true;
          const bil = siteAoi.sources.some((s: any) => s.side === 'ua') && siteAoi.sources.some((s: any) => s.side === 'ru');
          if (bil && !siteAoi.bilateral) {
            siteAoi.bilateral = true;
            if (siteAoi.hit && siteAoi.confidence && siteAoi.confidence !== 'news')
              siteAoi.confidence = siteAoi.confidence === 'low' ? 'med' : 'high';
          }
          continue;
        }

        const existing = newsByCell.get(key);
        if (existing) {
          // Upgrade news-only → fire-confirmed only on a meaningful fire hit
          if (meaningfulHit && !existing.hit) {
            existing.hit = true;
            existing.fireCount = meaningfulHit.count;
            existing.maxFrp = meaningfulHit.maxFrp;
            existing.latest = meaningfulHit.latest;
            existing.confidence = confidenceOf(meaningfulHit.count, meaningfulHit.maxFrp);
          }
          if (!existing.sources.some(s => s.source === contributor.source && s.title === contributor.title)) {
            existing.sources.push(contributor);
          }
          if (contributor.weapon && !existing.weapon) existing.weapon = contributor.weapon;
          if (contributor.hasVideo && !existing.videoConfirmed) {
            existing.videoConfirmed = true;
            // Video is corroborating evidence — upgrade unverified 'news' to 'low'
            if (existing.confidence === 'news') existing.confidence = 'low';
          }
          // Bilateral: both sides present in sources after adding this contributor
          const bilateral = existing.sources.some(s => s.side === 'ua') && existing.sources.some(s => s.side === 'ru');
          if (bilateral) {
            existing.bilateral = true;
            // Bump confidence one tier when both sides corroborate a fire
            if (existing.hit && existing.confidence !== 'news') {
              existing.confidence = existing.confidence === 'low' ? 'med' : 'high';
            }
          }
          continue;
        }
        const initVideo = !!n.hasVideo;
        const initConf: Confidence = meaningfulHit ? confidenceOf(meaningfulHit.count, meaningfulHit.maxFrp) : (initVideo ? 'low' : 'news');
        newsByCell.set(key, {
          id: `news-${newsByCell.size + 1}`, category: 'news', name: contributor.snippet || contributor.title || 'News report',
          source: n.source, side: n.side, link: n.link, lat, lng,
          hit: !!meaningfulHit, fireCount: meaningfulHit?.count ?? 0, maxFrp: meaningfulHit?.maxFrp ?? 0, latest: meaningfulHit?.latest ?? null,
          confidence: initConf,
          sources: [contributor], bilateral: false, videoConfirmed: initVideo, weapon: contributor.weapon,
        });
      }
    }
    for (const a of newsByCell.values()) aois.push(a);
    const newsHits = newsByCell.size;

    const siteHits = aois.filter(a => a.category !== 'news' && a.hit).length;
    const highConf = aois.filter(a => a.hit && a.confidence === 'high').length;
    return NextResponse.json(
      { aois, counts: { sites: SITES.length, site_hits: siteHits, news_hits: newsHits, high_confidence: highConf, fires_in_theater: fires.length }, timestamp: new Date().toISOString() },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' } }
    );
  } catch (error) {
    console.error('Strategic-thermal error:', error);
    return NextResponse.json({ aois: [], error: 'Failed to compute thermal AOIs' }, { status: 500 });
  }
}
