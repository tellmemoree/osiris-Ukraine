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

// Same theater box as strategic-thermal — western RU + Ukraine + occupied + Crimea.
const BBOX = { latMin: 43, latMax: 71, lngMin: 19, lngMax: 66 };

// Capture/liberation/control-change wording. Mirrors strategic-thermal's ADVANCE_TERMS
// (kept in sync deliberately — that route drops these, this one keeps them). PRECISE
// stems only: no bare "occupied"/`наступ` (the latter collides with "наступний"/next).
const ADVANCE_TERMS = [
  'liberat', 'recaptur', 'took control', 'under control', 'gained control', 'overran',
  'освобод', 'под контроль', 'захват', 'продвин',     // RU: liberated / under control / seized / advanced
  'звільн', 'під контроль', 'захопл', 'просун',       // UA: liberated / under control / captured / advanced
];
function isTerritorialAdvance(item: NewsItem): boolean {
  const t = `${item.title || ''} ${item.description || ''}`.toLowerCase();
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
  if (ru && ua) return 'ru'; // both named — RU is on the offensive across the current front
  return null;
}

// /api/news jitters `coords` ~6 km per-article (anti-stacking), so the SAME captured
// town reported by two channels lands in two cells and won't dedup. The raw, un-jittered
// centroid is in `places[]` (coords = jitterAround(one of them)) — recover it as the
// places entry nearest to `coords`, giving a stable position to plot AND dedup on.
function rawCentroid(item: NewsItem): [number, number] | null {
  if (!item.coords) return null;
  const places = item.places || [];
  if (!places.length) return item.coords;
  let best = places[0], bd = Infinity;
  for (const p of places) {
    const dLat = p[0] - item.coords[0], dLng = p[1] - item.coords[1];
    const d = dLat * dLat + dLng * dLng;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
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
    };
    // Dedup per place+side (~0.05°/~5 km). Same settlement claimed by the same side =
    // one marker (count the corroborating reports); a contested place claimed by BOTH
    // sides keeps two markers, which is itself the signal.
    const byCell = new Map<string, Capture>();
    let n = 0;
    for (const item of news) {
      if (!isTerritorialAdvance(item)) continue;
      if (!item.coords || item.coords_default) continue; // need a real geolocation
      const side = captureSide(item);
      if (!side) continue;
      const centroid = rawCentroid(item);
      if (!centroid) continue;
      const [lat, lng] = centroid;
      if (lat < BBOX.latMin || lat > BBOX.latMax || lng < BBOX.lngMin || lng > BBOX.lngMax) continue;
      const key = `${lat.toFixed(2)},${lng.toFixed(2)}|${side}`;
      const existing = byCell.get(key);
      if (existing) { existing.count++; continue; }
      byCell.set(key, {
        id: `cap-${++n}`, lat, lng, side,
        name: (item.title || 'Territorial change').slice(0, 120),
        source: item.source, side_reported: item.side, link: item.link, date: item.published, count: 1,
      });
    }

    const captures = [...byCell.values()];
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
