import { NextResponse } from 'next/server';
import { validateHost, isRateLimited, getClientIp } from '@/lib/ssrf-guard';

/**
 * OSIRIS — IP intelligence enrichment via Censys.
 *
 * Passive host enrichment (ASN, geo, open services, TLS certs) for a single IP,
 * complementing the Shodan lookup at /api/osint/shodan. This is NOT active
 * scanning — we query Censys's index, we never connect to the target.
 *
 * Auth: Censys legacy Search v2 host endpoint with HTTP Basic (API ID + secret).
 *   GET https://search.censys.io/api/v2/hosts/{ip}
 * The free Censys account includes a monthly credit allowance that covers
 * occasional per-host lookups; results are cached 6h to stay well under it.
 * (The newer Censys Platform PAT API is an alternative if you migrate creds.)
 *
 * Configure in .env:
 *   CENSYS_API_ID=...
 *   CENSYS_API_SECRET=...
 * Until both are set this route returns 503 (mirrors /api/scanner).
 */

const CENSYS_API_ID = process.env.CENSYS_API_ID || '';
const CENSYS_API_SECRET = process.env.CENSYS_API_SECRET || '';

interface IpIntel {
  ip: string;
  asn?: number;
  as_name?: string;
  country?: string;
  city?: string;
  lat?: number;
  lng?: number;
  services: { port: number; name?: string; transport?: string }[];
  certs: string[];
  last_updated?: string;
  source: string;
  status?: string;
  cached?: boolean;
}

// Minimal shape of the Censys v2 host response (only the fields we read).
interface CensysService {
  port?: number;
  service_name?: string;
  transport_protocol?: string;
  certificate?: string;
}
interface CensysHost {
  result?: {
    ip?: string;
    location?: { country?: string; city?: string; coordinates?: { latitude?: number; longitude?: number } };
    autonomous_system?: { asn?: number; name?: string };
    services?: CensysService[];
    last_updated_at?: string;
  };
}

// ── 6-hour result cache (keyed by IP) + inflight coalescing ──
// Conserves the free Censys credit allowance: repeated dashboard lookups for the
// same host cost at most one upstream call per 6h window.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const MAX_CACHE_ENTRIES = 500;
const cache = new Map<string, { data: IpIntel; at: number }>();
const inflight = new Map<string, Promise<IpIntel>>();
const CACHE_HEADERS = { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=43200' };

function getCached(ip: string): IpIntel | null {
  const hit = cache.get(ip);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  if (hit) cache.delete(ip);
  return null;
}

function setCached(ip: string, data: IpIntel): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(ip, { data, at: Date.now() });
}

// Query Censys and normalize. Throws on hard upstream failure so transient
// errors are not cached; a 404 (host not indexed) is a cacheable empty result.
async function enrich(ip: string): Promise<IpIntel> {
  const auth = Buffer.from(`${CENSYS_API_ID}:${CENSYS_API_SECRET}`).toString('base64');
  const res = await fetch(`https://search.censys.io/api/v2/hosts/${encodeURIComponent(ip)}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(9000),
    cache: 'no-store',
  });

  if (res.status === 404) {
    return { ip, status: 'No Censys records found', services: [], certs: [], source: 'censys' };
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Censys auth failed (HTTP ${res.status}) — check CENSYS_API_ID/SECRET`);
  }
  if (!res.ok) throw new Error(`Censys HTTP ${res.status}`);

  const body = (await res.json()) as CensysHost;
  const r = body.result ?? {};
  const services = (r.services ?? [])
    .filter((s) => typeof s.port === 'number')
    .slice(0, 50)
    .map((s) => ({ port: s.port as number, name: s.service_name, transport: s.transport_protocol }));
  const certs = Array.from(
    new Set((r.services ?? []).map((s) => s.certificate).filter((c): c is string => !!c))
  ).slice(0, 25);

  return {
    ip: r.ip || ip,
    asn: r.autonomous_system?.asn,
    as_name: r.autonomous_system?.name,
    country: r.location?.country,
    city: r.location?.city,
    lat: r.location?.coordinates?.latitude,
    lng: r.location?.coordinates?.longitude,
    services,
    certs,
    last_updated: r.last_updated_at,
    source: 'censys',
  };
}

export async function GET(req: Request) {
  // 1. Require credentials (graceful until the key is pasted into .env).
  if (!CENSYS_API_ID || !CENSYS_API_SECRET) {
    return NextResponse.json(
      { error: 'Censys not configured', hint: 'Set CENSYS_API_ID and CENSYS_API_SECRET in .env' },
      { status: 503 }
    );
  }

  // 2. Rate limit by client IP.
  if (isRateLimited(getClientIp(req), 10, 60_000)) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', detail: 'Maximum 10 lookups per minute.' },
      { status: 429 }
    );
  }

  // 3. Validate the IP param.
  const { searchParams } = new URL(req.url);
  const ip = searchParams.get('ip')?.trim();
  if (!ip) {
    return NextResponse.json({ error: 'Missing ip parameter' }, { status: 400 });
  }

  // 4. Reject private/reserved/invalid targets (don't leak internal IPs to Censys).
  const guard = await validateHost(ip);
  if (!guard.ok) {
    return NextResponse.json(
      { error: 'IP blocked', detail: `Validation failed: ${guard.reason}` },
      { status: 403 }
    );
  }

  // 5. Cache + coalesce.
  const cached = getCached(ip);
  if (cached) {
    return NextResponse.json({ ...cached, cached: true }, { headers: CACHE_HEADERS });
  }

  let task = inflight.get(ip);
  if (!task) {
    task = enrich(ip);
    inflight.set(ip, task);
  }

  try {
    const data = await task;
    setCached(ip, data);
    return NextResponse.json(data, { headers: CACHE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { error: 'Censys lookup failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    );
  } finally {
    inflight.delete(ip);
  }
}
