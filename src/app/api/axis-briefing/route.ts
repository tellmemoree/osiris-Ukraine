import { NextResponse } from 'next/server';
import { fetchDeepState, extractFeatures } from '@/lib/deepstate';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NewsItem {
  title: string;
  url?: string;
  ts: string;    // ISO 8601 UTC
  source?: string;
}

export interface AxisData {
  name: string;
  areaKm2: number;   // occupied area within bbox
  news: NewsItem[];  // up to 5 recent items
}

export interface AxisBriefingResponse {
  axes: AxisData[];
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes — data changes slowly

interface Axis {
  name: string;
  bbox: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
}

const AXES: Axis[] = [
  { name: 'Kharkiv',      bbox: [35.5, 49.5, 37.5, 51.0] },
  { name: 'Lyman',        bbox: [36.5, 48.5, 38.5, 49.8] },
  { name: 'Bakhmut',      bbox: [37.0, 47.8, 38.8, 48.8] },
  { name: 'Avdiivka',     bbox: [37.2, 47.5, 38.2, 48.2] },
  { name: 'Zaporizhzhia', bbox: [34.5, 47.0, 36.5, 48.2] },
  { name: 'Huliaipole',   bbox: [35.0, 47.2, 36.8, 47.9] },
  { name: 'Kherson',      bbox: [31.5, 46.0, 34.0, 47.5] },
  { name: 'Sumy',         bbox: [33.5, 50.5, 36.0, 52.0] },
];

// ---------------------------------------------------------------------------
// Module-level cache + inflight coalescing
// ---------------------------------------------------------------------------

let cache: AxisBriefingResponse | null = null;
let cachedAt = 0;
let inflight: Promise<AxisBriefingResponse> | null = null;

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

// Equirectangular shoelace area (km²) for a [lng, lat, ?z] ring.
// DeepState uses 3D coords [lng, lat, 0], so we accept arr.length >= 2.
function ringAreaKm2(ring: number[][]): number {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  let latSum = 0;
  for (const p of ring) latSum += p[1];
  const k = Math.cos((latSum / ring.length) * Math.PI / 180);
  let a2 = 0;
  for (let i = 0; i < ring.length; i++) {
    const next = (i + 1) % ring.length;
    const lng1 = ring[i][0],  lat1 = ring[i][1];
    const lng2 = ring[next][0], lat2 = ring[next][1];
    a2 += (lng1 * k) * lat2 - (lng2 * k) * lat1;
  }
  return Math.abs(a2 / 2) * 111.32 * 111.32;
}

function geomAreaKm2(geom: { type?: string; coordinates?: unknown }): number {
  if (!geom?.coordinates) return 0;
  const coords = geom.coordinates as number[][][] | number[][][][];
  if (geom.type === 'Polygon') {
    const rings = coords as number[][][];
    if (!rings.length) return 0;
    return rings.reduce((s, ring, i) => s + (i === 0 ? ringAreaKm2(ring) : -ringAreaKm2(ring)), 0);
  }
  if (geom.type === 'MultiPolygon') {
    const polys = coords as number[][][][];
    return polys.reduce(
      (s, rings) => s + rings.reduce((ps, ring, i) => ps + (i === 0 ? ringAreaKm2(ring) : -ringAreaKm2(ring)), 0),
      0,
    );
  }
  return 0;
}

// Does the polygon feature's bounding-box centroid (average of exterior ring)
// fall within the axis bbox? We use centroid-in-bbox as a fast proxy because
// DeepState polygons are already small front-line segments.
function featureCentroidInBbox(
  geom: { type?: string; coordinates?: unknown },
  [minLng, minLat, maxLng, maxLat]: [number, number, number, number],
): boolean {
  if (!geom?.coordinates) return false;
  let ring: number[][] | null = null;
  if (geom.type === 'Polygon') {
    ring = (geom.coordinates as number[][][])[0] ?? null;
  } else if (geom.type === 'MultiPolygon') {
    ring = ((geom.coordinates as number[][][][])[0]?.[0]) ?? null;
  }
  if (!ring || ring.length < 3) return false;

  let lngSum = 0, latSum = 0;
  for (const p of ring) { lngSum += p[0]; latSum += p[1]; }
  const cLng = lngSum / ring.length;
  const cLat = latSum / ring.length;

  return cLng >= minLng && cLng <= maxLng && cLat >= minLat && cLat <= maxLat;
}

// ---------------------------------------------------------------------------
// News helpers
// ---------------------------------------------------------------------------

// Raw news item shape returned by /api/news.
// `places` is [lat, lng][] (NOTE: lat-first, unlike GeoJSON lon-first).
interface RawNewsItem {
  title?: string;
  link?: string;
  published?: string;
  source?: string;
  places?: [number, number][];
  coords?: [number, number] | null;
  coords_default?: boolean;
}

function newsInBbox(
  item: RawNewsItem,
  [minLng, minLat, maxLng, maxLat]: [number, number, number, number],
): boolean {
  // Prefer `places` (all specific coordinates mentioned in the article).
  // `places` is [lat, lng] — note the order.
  const candidates: [number, number][] = [];
  if (item.places && item.places.length > 0) {
    candidates.push(...item.places);
  } else if (item.coords && !item.coords_default) {
    candidates.push(item.coords);
  }
  return candidates.some(([lat, lng]) =>
    lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng,
  );
}

// ---------------------------------------------------------------------------
// Core builder
// ---------------------------------------------------------------------------

async function buildBriefing(reqUrl: string): Promise<AxisBriefingResponse> {
  // Fetch DeepState and news in parallel.
  const [deepStateData, newsRaw] = await Promise.all([
    fetchDeepState(),
    fetch(new URL('/api/news', reqUrl).href, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { news: [] }))
      .catch(() => ({ news: [] })),
  ]);

  const features = extractFeatures(deepStateData) as {
    geometry?: { type?: string; coordinates?: unknown };
  }[];

  const newsItems: RawNewsItem[] = Array.isArray(newsRaw?.news) ? newsRaw.news : [];

  // Sort news by recency once, then reuse across axes.
  const sortedNews = [...newsItems].sort(
    (a, b) =>
      new Date(b.published ?? 0).getTime() - new Date(a.published ?? 0).getTime(),
  );

  const axes: AxisData[] = AXES.map((axis) => {
    // --- area ----------------------------------------------------------
    const areaKm2 = Math.round(
      features.reduce((sum, f) => {
        const geom = f.geometry;
        if (!geom) return sum;
        if (!featureCentroidInBbox(geom, axis.bbox)) return sum;
        return sum + geomAreaKm2(geom);
      }, 0),
    );

    // --- news ----------------------------------------------------------
    const axisNews: NewsItem[] = [];
    for (const item of sortedNews) {
      if (axisNews.length >= 5) break;
      if (!newsInBbox(item, axis.bbox)) continue;
      axisNews.push({
        title: item.title ?? '(no title)',
        url: item.link,
        ts: item.published ?? new Date().toISOString(),
        source: item.source,
      });
    }

    return { name: axis.name, areaKm2, news: axisNews };
  });

  return { axes, timestamp: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const force = url.searchParams.get('force') === '1';
  const now = Date.now();

  // Serve from cache unless busted or stale.
  if (!force && cache && now - cachedAt < CACHE_TTL_MS) {
    return NextResponse.json(cache, {
      headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' },
    });
  }

  // Inflight coalescing — one pending fetch per module, not one per request.
  if (inflight) {
    const data = await inflight;
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' },
    });
  }

  inflight = buildBriefing(req.url);
  try {
    const data = await inflight;
    cache = data;
    cachedAt = Date.now();
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' },
    });
  } catch (err) {
    console.error('[axis-briefing] build failed:', err);
    // Serve stale on upstream failure rather than empty.
    if (cache) {
      return NextResponse.json(cache, {
        headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
      });
    }
    return NextResponse.json(
      { axes: [], timestamp: new Date().toISOString(), error: 'Upstream unavailable' },
      { status: 502 },
    );
  } finally {
    inflight = null;
  }
}
