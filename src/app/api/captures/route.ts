import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * OSIRIS — Territorial Captures / Advances.
 *
 * The flip-side of /api/strategic-thermal: where that route EXCLUDES territorial-advance
 * reports as strike false-positives, this route SURFACES them as their own layer. It
 * fetches /api/news, keeps the capture/liberation/control-change items, and classifies
 * each by the ACTOR that advanced — NOT the reporting channel's `side` (a Ukrainian
 * channel routinely reports a Russian capture, and vice-versa), so RU and UA gains can be
 * coloured differently on the map.
 *
 * Heuristic, like all news geolocation here: a "capture" is a milblogger claim placed at a
 * city-level gazetteer centroid. Treat as a lead; control changes are contested and
 * frequently walked back. Markers carry the article so the claim can be verified.
 */

interface NewsItem { title?: string; description?: string; source?: string; side?: string; link?: string; coords?: [number, number] | null; coords_default?: boolean; places?: [number, number][]; place_names?: string[]; published?: string; }

// Active contact zone only. Covers Kherson/Zaporizhzhia north through the Kursk
// incursion axis. Excludes deep Russia (Bryansk 53°N, Adygea 44°N, Rostov east of 40°E).
const CONTACT_BBOX = { latMin: 45.5, latMax: 52.5, lngMin: 31.5, lngMax: 41.0 }; // lngMax stays ~41 to exclude Russian staging areas beyond the Luhansk/Starobilsk axis

// Capture/liberation/control-change wording. Mirrors strategic-thermal's ADVANCE_TERMS
// (kept in sync deliberately — that route drops these, this one keeps them).
// Removed: `просун` (collides with "reform progress"), `наступають` (too generic),
// `захват` (appears in non-territorial hostage/seizure contexts).
const ADVANCE_TERMS = [
  'liberat', 'recaptur', 'took control', 'under control', 'gained control', 'overran',
  'overrun', 'fallen to', 'fell to', 'seized by', 'stormed',
  'освобод', 'под контроль', 'продвин', 'штурм', 'прорвали',
  'звільн', 'під контроль', 'захопл',
  'встановив контрол', 'встановлено контрол', 'зайняли', 'зайняв', 'штурмують',
  'відійшли', 'залишили', 'ворог увійшов',
];

// Daily digest / roundup titles that contain territorial language but are summaries,
// not individual capture claims. Checked against the title only (lowercased).
const DIGEST_TITLE_RE = /^(главное за|сводка|зведення|дайджест|итоги дня|підсумки|обзор за|за сутки|за добу|morning brief|evening brief|daily (round|update|brief|wrap))/i;

// A year in 2014–2021 appearing in the title signals a historical anniversary post,
// not a current territorial change. The war-relevant range starts 2022.
const HISTORICAL_YEAR_RE = /\b(201[4-9]|202[0-4])\b/;

// Political/administrative news whose title contains advance-like vocabulary
// (e.g. "деталі армійської реформи") but has no territorial content.
const POLITICAL_RE = /реформ|reform|мобілізац|mobili[zs]|законопроект|закон про|бюджет|budget|призов|conscript|нагород|указ президент|указ про|decree|перемов|переговор|санкц|sanction/i;

// ── Module-level cache ───────────────────────────────────────────────────────
const CACHE_TTL = 60_000;
type CapturesPayload = { captures: unknown[]; counts: { total: number; ru: number; ua: number }; timestamp: string };
let cachedCaptures: CapturesPayload | null = null;
let lastFetch = 0;

function isTerritorialAdvance(item: NewsItem): boolean {
  const title = (item.title || '').toLowerCase();
  const t = `${title} ${(item.description || '').toLowerCase()}`;
  if (DIGEST_TITLE_RE.test(title)) return false;
  if (HISTORICAL_YEAR_RE.test(title)) return false;
  if (POLITICAL_RE.test(item.title || '')) return false;
  return ADVANCE_TERMS.some(w => t.includes(w));
}

/**
 * Which side ADVANCED. Each side has its own euphemism for its own gains, which is a
 * strong signal regardless of who is reporting:
 *   - RU frames its captures as "освобождение" (liberation) → ru.
 *   - UA frames its recaptures as "звільнення" / "deoccupation" → ua.
 *   - Hostile framing ("окупували / захопили / occupied / seized") describes territory
 *     LOST, almost always to RU on the current front → ru.
 * Generic verbs ("took control", bare "liberated") fall back to whichever army is named.
 * Returns null when no actor can be determined (marker is dropped — better than guessing).
 */
function captureSide(item: NewsItem): 'ru' | 'ua' | null {
  const t = `${item.title || ''} ${item.description || ''}`.toLowerCase();
  if (/звільн|деокуп|deoccup|recaptur|re-?captur|liberated by ukrain|ukrainian forces liberat/.test(t)) return 'ua';
  if (/освобожд|освобод/.test(t)) return 'ru';
  if (/окуп|захопл|захвач|захват/.test(t)) return 'ru';
  const ru = /\brussia|russian|росси|росій|\bрф\b|вс рф|минобороны|оккупан|wagner|группировк/.test(t);
  const ua = /ukrain|укра[іиї]|зсу|\bafu\b|сил оборони|сили оборони|генштаб/.test(t);
  if (ru && !ua) return 'ru';
  if (ua && !ru) return 'ua';
  if (ru && ua) return null; // ambiguous — drop rather than guess
  return null;
}

// Cyrillic aliases for Latin gazetteer keys — covers frontline cities that appear
// in Cyrillic-title milblogger posts. Title-match in allCentroids() is script-aware:
// a Latin gazetteer key like 'kostiantynivka' won't substring-match a Cyrillic title.
// Each entry maps the Latin gazetteer key → Cyrillic forms seen in UA/RU Telegram posts.
const CYR_ALIASES: Record<string, string[]> = {
  'kostiantynivka': ['константинівка', 'константиновка', 'костянтинівка'],
  'pokrovsk':       ['покровськ', 'покровск'],
  'chasiv yar':     ['часів яр', 'часовой яр', 'часовий яр'],
  'toretsk':        ['торецьк', 'торецк', 'дзержинськ'],
  'vovchansk':      ['вовчанськ', 'вовчанск'],
  'kupiansk':       ['куп\'янськ', 'купянск'],
  'lyman':          ['лиман'],
  'bakhmut':        ['бахмут', 'артемівськ'],
  'avdiivka':       ['авдіївка', 'авдеевка'],
  'kurakhove':      ['курахове', 'курахово'],
  'velyka novosilka': ['велика новосілка', 'великая новосёлка'],
  'orikhiv':        ['оріхів', 'орехов'],
  'robotyne':       ['роботине', 'работино'],
  'hulyaipole':     ['гуляйполе'],
  'donetsk':        ['донецьк', 'донецк'],
  'kherson':        ['херсон'],
  'zaporizhzhia':   ['запоріжжя', 'запорожье'],
  'kharkiv':        ['харків', 'харьков'],
  'kramatorsk':     ['краматорськ', 'краматорск'],
  'sloviansk':      ['слов\'янськ', 'славянск'],
};

// Return only the PRIMARY place centroid for an article. Using all places[] would
// scatter markers to every geographic mention in the body — comparison cities, political
// context, Kyiv-as-capital references — none of which represent the claimed territory.
// Primary = first place whose name appears in the title (Latin or Cyrillic alias);
// fall back to places[0] or jittered coords if no title match is found.
function allCentroids(item: NewsItem): [number, number][] {
  const { places, place_names, title, coords } = item;
  if (places && place_names && places.length === place_names.length && places.length > 0) {
    const lowerTitle = (title || '').toLowerCase();
    const titleMatch = place_names.findIndex(name => {
      if (lowerTitle.includes(name.toLowerCase())) return true;
      // Cyrillic titles: check aliases for this Latin gazetteer key
      return (CYR_ALIASES[name.toLowerCase()] || []).some(cyr => lowerTitle.includes(cyr));
    });
    if (titleMatch !== -1) return [places[titleMatch]];
  }
  const primary = places?.[0] ?? coords;
  return primary ? [primary] : [];
}

async function fetchNews(req: Request): Promise<NewsItem[]> {
  try {
    const res = await fetch(new URL('/api/news', req.url), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const d = await res.json();
    return Array.isArray(d.news) ? d.news : [];
  } catch { return []; }
}

export async function GET(req: Request) {
  if (cachedCaptures && Date.now() - lastFetch < CACHE_TTL) {
    return NextResponse.json(cachedCaptures, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
    });
  }

  try {
    const news = await fetchNews(req);

    type Capture = {
      id: string; lat: number; lng: number; side: 'ru' | 'ua'; name: string;
      source?: string; side_reported?: string; link?: string; date?: string; count: number;
      description?: string;
      conflicted: boolean;
      other_name?: string;
      other_link?: string;
      other_source?: string;
      other_side?: 'ru' | 'ua';
    };
    // Dedup per place+side (~0.05°/~5 km). Same settlement claimed by the same side =
    // one marker (count the corroborating reports); a contested place claimed by BOTH
    // sides keeps two markers, which is itself the signal.
    // count = distinct reporting channels/sources, not total articles. Two articles
    // from the same milblogger re-posting the same claim do not bump the count.
    const byCell = new Map<string, Capture>();
    const cellSources = new Map<string, Set<string>>(); // distinct sources per cell key
    const locationSides = new Map<string, Set<'ru' | 'ua'>>(); // track which sides claim each location
    let n = 0;
    for (const item of news) {
      if (!isTerritorialAdvance(item)) continue;
      if (!item.coords || item.coords_default) continue; // need a real geolocation
      const side = captureSide(item);
      if (!side) continue;
      // Emit one marker per named place — a single article can mention 3 locations
      // and should produce 3 markers, one at each.
      for (const [lat, lng] of allCentroids(item)) {
        if (lat < CONTACT_BBOX.latMin || lat > CONTACT_BBOX.latMax || lng < CONTACT_BBOX.lngMin || lng > CONTACT_BBOX.lngMax) continue;
        const locKey = `${lat.toFixed(2)},${lng.toFixed(2)}`;
        if (!locationSides.has(locKey)) locationSides.set(locKey, new Set());
        locationSides.get(locKey)!.add(side);

        const key = `${locKey}|${side}`;
        const existing = byCell.get(key);
        if (existing) {
          // Only increment count when this is a new distinct source channel.
          const sources = cellSources.get(key)!;
          sources.add(item.source ?? '');
          existing.count = sources.size;
          continue;
        }
        const initSources = new Set([item.source ?? '']);
        cellSources.set(key, initSources);
        byCell.set(key, {
          id: `cap-${++n}`, lat, lng, side,
          name: (item.title || 'Territorial change').slice(0, 120),
          source: item.source, side_reported: item.side, link: item.link, date: item.published, count: 1,
          description: item.description?.slice(0, 220),
          conflicted: false,
        });
      }
    }

    // Conflicted-claim post-pass: group by bare lat/lng cell (ignoring side).
    // If both ru and ua have a marker at the same cell, flag both as conflicted
    // and cross-populate the partner's attribution fields.
    const byBareCell = new Map<string, Capture[]>();
    for (const capture of byCell.values()) {
      const bareKey = `${capture.lat.toFixed(2)},${capture.lng.toFixed(2)}`;
      const bucket = byBareCell.get(bareKey);
      if (bucket) { bucket.push(capture); } else { byBareCell.set(bareKey, [capture]); }
    }
    for (const bucket of byBareCell.values()) {
      if (bucket.length < 2) continue;
      const ru = bucket.find(c => c.side === 'ru');
      const ua = bucket.find(c => c.side === 'ua');
      if (!ru || !ua) continue;
      ru.conflicted = true;
      ru.other_name = ua.name;
      ru.other_link = ua.link;
      ru.other_source = ua.source;
      ru.other_side = 'ua';
      ua.conflicted = true;
      ua.other_name = ru.name;
      ua.other_link = ru.link;
      ua.other_source = ru.source;
      ua.other_side = 'ru';
    }

    const captures = [...byCell.values()];
    const payload: CapturesPayload = {
      captures,
      counts: { total: captures.length, ru: captures.filter(c => c.side === 'ru').length, ua: captures.filter(c => c.side === 'ua').length },
      timestamp: new Date().toISOString(),
    };
    cachedCaptures = payload;
    lastFetch = Date.now();
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
    });
  } catch (error) {
    console.error('Captures error:', error);
    return NextResponse.json({ captures: [], error: 'Failed to compute captures' }, { status: 500 });
  }
}
