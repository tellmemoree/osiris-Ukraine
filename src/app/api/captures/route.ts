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

interface NewsItem { title?: string; description?: string; source?: string; side?: string; link?: string; coords?: [number, number] | null; coords_default?: boolean; places?: [number, number][]; published?: string; }

// Active contact zone only. Covers Kherson/Zaporizhzhia north through the Kursk
// incursion axis. Excludes deep Russia (Bryansk 53°N, Adygea 44°N, Rostov east of 40°E).
const CONTACT_BBOX = { latMin: 45.5, latMax: 52.5, lngMin: 31.5, lngMax: 40.0 };

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

// Return only the PRIMARY place centroid for an article. Using all places[] would
// scatter markers to every geographic mention in the body — comparison cities, political
// context, Kyiv-as-capital references — none of which represent the claimed territory.
// Primary = first gazetteer hit (highest rank); fall back to jittered coords.
function allCentroids(item: NewsItem): [number, number][] {
  const primary = item.places?.[0] ?? item.coords;
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
  try {
    const news = await fetchNews(req);

    type Capture = {
      id: string; lat: number; lng: number; side: 'ru' | 'ua'; name: string;
      source?: string; side_reported?: string; link?: string; date?: string; count: number;
      description?: string; conflicted?: boolean;
    };
    // Dedup per place+side (~0.05°/~5 km). Same settlement claimed by the same side =
    // one marker (count the corroborating reports); a contested place claimed by BOTH
    // sides keeps two markers, which is itself the signal.
    const byCell = new Map<string, Capture>();
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
        if (existing) { existing.count++; continue; }
        byCell.set(key, {
          id: `cap-${++n}`, lat, lng, side,
          name: (item.title || 'Territorial change').slice(0, 120),
          source: item.source, side_reported: item.side, link: item.link, date: item.published, count: 1,
          description: item.description?.slice(0, 220),
        });
      }
    }

    // Mark captures as conflicted if location has both RU and UA claims
    const captures = [...byCell.values()].map(cap => ({
      ...cap,
      conflicted: locationSides.get(`${cap.lat.toFixed(2)},${cap.lng.toFixed(2)}`)!.size > 1,
    }));
    return NextResponse.json(
      {
        captures,
        counts: { total: captures.length, ru: captures.filter(c => c.side === 'ru').length, ua: captures.filter(c => c.side === 'ua').length },
        timestamp: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } }
    );
  } catch (error) {
    console.error('Captures error:', error);
    return NextResponse.json({ captures: [], error: 'Failed to compute captures' }, { status: 500 });
  }
}
