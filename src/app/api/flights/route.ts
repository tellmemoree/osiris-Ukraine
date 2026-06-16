
import { NextResponse } from 'next/server';
import { stealthFetch } from '@/lib/stealthFetch';

/**
 * OSIRIS — Flight Data API
 * Fetches real-time aircraft positions from adsb.lol (no API key required)
 * Covers 6 global regions for maximum coverage
 */

const REGIONS = [
  { lat: 39.8, lon: -98.5, dist: 2000 },   // North America
  { lat: 50.0, lon: 15.0, dist: 2000 },     // Europe
  { lat: 35.0, lon: 105.0, dist: 2000 },    // Asia
  { lat: -25.0, lon: 133.0, dist: 2000 },   // Australia
  { lat: 0.0, lon: 20.0, dist: 2500 },      // Africa
  { lat: -15.0, lon: -60.0, dist: 2000 },   // South America
];

// Helicopter type codes
const HELI_TYPES = new Set([
  'R22','R44','R66','B06','B06T','B204','B205','B206','B212','B222','B230',
  'B407','B412','B427','B429','B430','B505','B525',
  'AS32','AS35','AS50','AS55','AS65',
  'EC20','EC25','EC30','EC35','EC45','EC55','EC75',
  'H125','H130','H135','H145','H155','H160','H175','H215','H225',
  'S55','S58','S61','S64','S70','S76','S92',
  'A109','A119','A139','A169','A189','AW09',
  'MD52','MD60','MDHI','MD90','NOTR',
  'B47G','HUEY','GAMA','CABR','EXE',
]);

// Private jet types
const PRIVATE_JET_TYPES = new Set([
  'G150','G200','G280','GLEX','G500','G550','G600','G650','G700',
  'GLF2','GLF3','GLF4','GLF5','GLF6','GL5T','GL7T','GV','GIV',
  'CL30','CL35','CL60','BD70','BD10',
  'C25A','C25B','C25C','C500','C510','C525','C550','C560','C56X','C680','C700','C750',
  'E35L','E50P','E55P','E545','E550',
  'FA50','FA7X','FA8X','F900','F2TH',
  'LJ35','LJ40','LJ45','LJ60','LJ70','LJ75',
  'PC12','PC24','TBM7','TBM8','TBM9',
  'PRM1','SF50','EA50','VLJ',
]);

// Military type indicators
const MILITARY_INDICATORS = new Set([
  'C17','C5M','C130','C30J','KC10','KC46','KC35','E3CF','E3TF','E8A',
  'B1B','B2','B52','F16','F15','F18','F22','F35','A10','F117',
  'RC135','E6B','P8A','P3','MQ9','RQ4','U2','EP3','RC12',
  'V22','CH47','UH60','AH64','AH1Z','MV22',
  'EUFI','RFAL','TORD','TYP','GR4',
]);

const AIRLINE_CODE_RE = /^([A-Z]{3})\d/;

// Raw aircraft record as returned by adsb.lol's `ac` array (only the fields we read).
// `alt_baro` is feet and can be the string "ground" for aircraft on the surface.
interface AdsbAircraft {
  hex?: string;
  flight?: string;
  t?: string;
  r?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | string;
  gs?: number;
  track?: number;
  squawk?: string;
  dbFlags?: number;
  nac_p?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// adsb.lol rate-limits bursty/parallel requests hard: firing all 6 regions at
// once returns 429 for all but one, so only a single region's aircraft ever
// reach the map (the "planes in one place only" bug). We therefore fetch
// regions sequentially (see refreshAll) and retry a throttled region with
// backoff. Returns null on failure so the caller can keep that region's
// last-good aircraft instead of blanking it; returns [] only on a genuine
// empty success.
async function fetchRegion(region: typeof REGIONS[0]): Promise<AdsbAircraft[] | null> {
  const url = `https://api.adsb.lol/v2/lat/${region.lat}/lon/${region.lon}/dist/${region.dist}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await stealthFetch(url, { signal: AbortSignal.timeout(12000) });
      if (res.status === 429) {
        await sleep(1500);
        continue;
      }
      if (res.ok) {
        const data = (await res.json()) as { ac?: AdsbAircraft[] };
        return data.ac ?? [];
      }
      return null; // non-429 HTTP error — don't clobber last-good data
    } catch (e) {
      if (attempt === 2) {
        console.warn(`Region fetch failed for lat=${region.lat}:`, e);
        return null;
      }
      await sleep(1000);
    }
  }
  return null; // exhausted 429 retries — keep last-good
}

function classifyFlight(f: AdsbAircraft) {
  const modelUpper = (f.t || '').toUpperCase();
  const flightStr = (f.flight || '').trim().toUpperCase();
  const dbFlags = (f.dbFlags || 0);

  // Skip fixed structures
  if (modelUpper === 'TWR') return null;

  const lat = f.lat;
  const lon = f.lon;
  if (lat == null || lon == null) return null;

  const callsign = flightStr || f.hex || 'UNKNOWN';
  const altRaw = f.alt_baro;
  const altMeters = typeof altRaw === 'number' ? altRaw * 0.3048 : 0;
  const speedKnots = typeof f.gs === 'number' ? Math.round(f.gs * 10) / 10 : null;
  const heading = f.track || 0;
  const isHeli = HELI_TYPES.has(modelUpper);
  const isGrounded = typeof altRaw === 'number' && altRaw < 100;

  // Extract airline code
  const airlineMatch = AIRLINE_CODE_RE.exec(callsign);
  const airlineCode = airlineMatch ? airlineMatch[1] : '';

  // Classification
  let category: 'commercial' | 'private' | 'jet' | 'military' = 'commercial';
  if (dbFlags & 1 || MILITARY_INDICATORS.has(modelUpper) || (f.flight || '').match(/^(RCH|KING|DUKE|EVAC|JAKE|REACH|CONVOY)\d/i)) {
    category = 'military';
  } else if (PRIVATE_JET_TYPES.has(modelUpper)) {
    category = 'jet';
  } else if (!airlineCode && modelUpper && !['A319','A320','A321','A332','A333','A339','A343','A359','A388','B737','B738','B739','B38M','B39M','B752','B753','B763','B764','B772','B77L','B77W','B788','B789','B78X','E170','E175','E190','E195','CRJ7','CRJ9','AT43','AT72','DH8D'].includes(modelUpper)) {
    category = 'private';
  }

  const classifiedLat = Math.round(lat * 100000) / 100000;
  const classifiedLng = Math.round(lon * 100000) / 100000;

  return {
    callsign,
    lat: classifiedLat,
    lng: classifiedLng,
    alt: Math.round(altMeters),
    heading: Math.round(heading),
    speed_knots: speedKnots,
    model: f.t || 'Unknown',
    icao24: f.hex || '',
    registration: f.r || 'N/A',
    squawk: f.squawk || '',
    airline_code: airlineCode,
    aircraft_category: isHeli ? 'heli' : 'plane',
    category,
    grounded: isGrounded,
    nac_p: f.nac_p,
    type: 'flight',
  };
}

// In-memory cache to prevent global fan-out abuse
// NOTE (Issue #110): This cache is per-isolate in serverless environments (Vercel).
// Multiple isolates may each hold their own cache, but this is acceptable because:
// 1. It coalesces concurrent requests within the same isolate
// 2. It prevents hammering adsb.lol which would cause rate-limit bans
// For a globally shared cache, migrate to Vercel KV or similar persistent store.
type ClassifiedFlight = NonNullable<ReturnType<typeof classifyFlight>>;
type JammingPoint = { lat: number; lng: number; nac_p: number; callsign: string };

interface FlightResponse {
  commercial_flights: ClassifiedFlight[];
  private_flights: ClassifiedFlight[];
  private_jets: ClassifiedFlight[];
  military_flights: ClassifiedFlight[];
  gps_jamming: ReturnType<typeof aggregateJamming>;
  total: number;
  timestamp: string;
}

const JAMMING_NACAP_THRESHOLD = 4;

// Per-region last-good aircraft, keyed by REGIONS index. Persisting per region
// (rather than one combined snapshot) means a transient 429/timeout on a single
// region keeps that region's previous aircraft on the map instead of blanking
// them — the combined view degrades gracefully instead of collapsing to whatever
// one region happened to win the race.
const regionCache = new Map<number, AdsbAircraft[]>();

let cachedData: FlightResponse | null = null;
let lastFetchTime = 0;
const CACHE_TTL = 60000; // rebuild the combined snapshot at most once per minute
const REGION_SPACING_MS = 1200; // pause between sequential region fetches
let refreshing: Promise<void> | null = null;
// Rotating start index for the sequential sweep. adsb.lol may throttle us partway
// through a sweep, starving whichever regions come last; rotating the start each
// sweep gives every region a turn at the front, and the per-region last-good
// cache retains the others — so all six populate over successive sweeps.
let sweepOffset = 0;

// Build the classified response from every region's last-good aircraft, deduped
// by ICAO hex across overlapping region radii.
function buildResponse(): FlightResponse {
  const allRaw: AdsbAircraft[] = [];
  const seenHex = new Set<string>();
  for (const regionAc of regionCache.values()) {
    for (const ac of regionAc) {
      const hex = (ac.hex || '').toLowerCase().trim();
      if (hex && !seenHex.has(hex)) {
        seenHex.add(hex);
        allRaw.push(ac);
      }
    }
  }

  const commercial: ClassifiedFlight[] = [];
  const privateFl: ClassifiedFlight[] = [];
  const jets: ClassifiedFlight[] = [];
  const military: ClassifiedFlight[] = [];
  const gpsJamming: JammingPoint[] = [];

  for (const raw of allRaw) {
    const flight = classifyFlight(raw);
    if (!flight) continue;

    // GPS jamming detection
    if (typeof flight.nac_p === 'number' && flight.nac_p <= JAMMING_NACAP_THRESHOLD && !flight.grounded) {
      gpsJamming.push({
        lat: flight.lat,
        lng: flight.lng,
        nac_p: flight.nac_p,
        callsign: flight.callsign,
      });
    }

    switch (flight.category) {
      case 'military': military.push(flight); break;
      case 'jet': jets.push(flight); break;
      case 'private': privateFl.push(flight); break;
      default: commercial.push(flight);
    }
  }

  return {
    commercial_flights: commercial,
    private_flights: privateFl,
    private_jets: jets,
    military_flights: military,
    gps_jamming: aggregateJamming(gpsJamming, JAMMING_NACAP_THRESHOLD),
    total: allRaw.length,
    timestamp: new Date().toISOString(),
  };
}

// Sweep all regions sequentially (adsb.lol 429s parallel bursts), updating each
// region's last-good cache only on success, then rebuild the combined snapshot.
async function refreshAll(): Promise<void> {
  const start = sweepOffset;
  sweepOffset = (sweepOffset + 1) % REGIONS.length;
  for (let n = 0; n < REGIONS.length; n++) {
    const i = (start + n) % REGIONS.length;
    const ac = await fetchRegion(REGIONS[i]);
    if (ac !== null) regionCache.set(i, ac); // null = keep last-good
    if (n < REGIONS.length - 1) await sleep(REGION_SPACING_MS);
  }
  cachedData = buildResponse();
  lastFetchTime = Date.now();
}

export async function GET() {
  const now = Date.now();
  const stale = !cachedData || now - lastFetchTime > CACHE_TTL;

  // Kick a background refresh when stale; the guard ensures only one sweep runs
  // at a time regardless of how many requests arrive during it.
  if (stale && !refreshing) {
    refreshing = refreshAll().finally(() => { refreshing = null; });
  }

  // Cold start: nothing cached yet — wait for the first sweep to populate so the
  // initial load returns aircraft rather than an empty layer for a full poll
  // cycle. Subsequent requests are served instantly from cache while refreshing.
  if (!cachedData && refreshing) {
    try { await refreshing; } catch { /* fall through to empty response */ }
  }

  const body: FlightResponse = cachedData ?? {
    commercial_flights: [],
    private_flights: [],
    private_jets: [],
    military_flights: [],
    gps_jamming: [],
    total: 0,
    timestamp: new Date().toISOString(),
  };

  // Don't let a sparse/empty result (transient upstream failure) get cached
  // downstream, so the next poll retries instead of serving it for the full TTL.
  const cacheControl = body.total < 100
    ? 'no-store, max-age=0'
    : 'public, s-maxage=30, stale-while-revalidate=60';

  return NextResponse.json(body, { headers: { 'Cache-Control': cacheControl } });
}

function aggregateJamming(points: JammingPoint[], threshold: number) {
  if (points.length === 0) return [];
  const grid = new Map<string, { lat: number; lng: number; count: number; total_nac_p: number }>();
  const GRID_SIZE = 2; // degrees

  for (const p of points) {
    const gLat = Math.floor(p.lat / GRID_SIZE) * GRID_SIZE;
    const gLng = Math.floor(p.lng / GRID_SIZE) * GRID_SIZE;
    const key = `${gLat},${gLng}`;

    if (!grid.has(key)) {
      grid.set(key, { lat: gLat + GRID_SIZE / 2, lng: gLng + GRID_SIZE / 2, count: 0, total_nac_p: 0 });
    }
    const cell = grid.get(key)!;
    cell.count++;
    cell.total_nac_p += p.nac_p;
  }

  return Array.from(grid.values())
    .filter(z => z.count >= 3) // Minimum 3 aircraft with degraded NACp
    .map(z => ({
      lat: z.lat,
      lng: z.lng,
      severity: Math.round((1 - (z.total_nac_p / z.count) / threshold) * 100),
      count: z.count,
    }));
}

