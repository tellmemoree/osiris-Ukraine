import { NextResponse } from 'next/server';
import { validateHost, isRateLimited, getClientIp } from '@/lib/ssrf-guard';

/**
 * OSIRIS — IP intelligence enrichment via Censys.
 *
 * Passive host enrichment (ASN, geo, open services, TLS certs) for a single IP.
 * Uses Censys Search v3 with a PAT (Personal Access Token, censys_* prefix).
 *   GET https://search.censys.io/api/v3/hosts/{ip}
 * Results are cached 6h to stay within the free monthly credit allowance.
 *
 * Configure in .env:  CENSYS_API_ID=censys_...
 * Without it the route falls back to ipinfo.io + Shodan InternetDB (keyless).
 */

const CENSYS_API_ID = process.env.CENSYS_API_ID || '';
const CENSYS_API_SECRET = process.env.CENSYS_API_SECRET || '';

interface GreyNoiseResult {
  noise: boolean;
  riot: boolean;
  classification?: string;
  name?: string;
  link?: string;
  last_seen?: string;
}

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
  greynoise?: GreyNoiseResult;
}

// Minimal shape of the Censys v3 host response (only the fields we read).
// v3 keeps the same result envelope as v2 but uses Bearer (PAT) auth.
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

// Build the Authorization header for Censys.
// PATs (censys_* prefix) use Bearer; legacy api_id+api_secret pairs use Basic.
function censysAuthHeader(): string {
  if (CENSYS_API_ID.startsWith('censys_')) {
    return `Bearer ${CENSYS_API_ID}`;
  }
  return `Basic ${Buffer.from(`${CENSYS_API_ID}:${CENSYS_API_SECRET}`).toString('base64')}`;
}

// Query Censys and normalize. Throws on hard upstream failure so transient
// errors are not cached; a 404 (host not indexed) is a cacheable empty result.
async function enrich(ip: string): Promise<IpIntel> {
  const res = await fetch(`https://search.censys.io/api/v3/hosts/${encodeURIComponent(ip)}`, {
    headers: { Authorization: censysAuthHeader(), Accept: 'application/json' },
    signal: AbortSignal.timeout(9000),
    cache: 'no-store',
  });

  if (res.status === 404) {
    return { ip, status: 'No Censys records found', services: [], certs: [], source: 'censys' };
  }
  if (res.status === 401 || res.status === 403) {
    // Auth failed — silently fall back to free sources rather than hard-erroring.
    return enrichFree(ip);
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

  const greynoise = await fetchGreyNoise(ip).catch(() => undefined);

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
    greynoise,
    source: 'censys + greynoise',
  };
}

async function fetchGreyNoise(ip: string): Promise<GreyNoiseResult | undefined> {
  try {
    const res = await fetch(`https://api.greynoise.io/v3/community/${encodeURIComponent(ip)}`, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (!res.ok) return undefined;
    const d = await res.json();
    if (d.message && d.message !== 'Success') return undefined;
    return { noise: d.noise, riot: d.riot, classification: d.classification, name: d.name, link: d.link, last_seen: d.last_seen };
  } catch {
    return undefined;
  }
}

// Free fallback: ipinfo.io (geo/ASN) + Shodan InternetDB (ports/services) + GreyNoise.
// Used when Censys creds are absent or incomplete.
async function enrichFree(ip: string): Promise<IpIntel> {
  const [geoRes, shodanRes, gnRes] = await Promise.allSettled([
    fetch(`https://ipinfo.io/${encodeURIComponent(ip)}/json`, {
      signal: AbortSignal.timeout(6000), cache: 'no-store',
    }),
    fetch(`https://internetdb.shodan.io/${encodeURIComponent(ip)}`, {
      signal: AbortSignal.timeout(6000), cache: 'no-store',
    }),
    fetchGreyNoise(ip),
  ]);

  let lat: number | undefined, lng: number | undefined, city: string | undefined,
    country: string | undefined, asn: number | undefined, as_name: string | undefined;

  if (geoRes.status === 'fulfilled' && geoRes.value.ok) {
    const g = await geoRes.value.json();
    [lat, lng] = (g.loc ?? '').split(',').map(Number);
    city = g.city;
    country = g.country;
    if (g.org) {
      const m = g.org.match(/^AS(\d+)\s+(.*)/);
      if (m) { asn = parseInt(m[1], 10); as_name = m[2]; }
    }
  }

  let services: IpIntel['services'] = [];
  if (shodanRes.status === 'fulfilled' && shodanRes.value.ok) {
    const s = await shodanRes.value.json();
    services = (s.ports ?? []).map((p: number) => ({ port: p }));
  }

  const greynoise = gnRes.status === 'fulfilled' ? gnRes.value : undefined;

  return { ip, asn, as_name, city, country, lat, lng, services, certs: [], greynoise, source: 'ipinfo.io + shodan + greynoise' };
}

// True when we have enough Censys credentials to attempt a query.
// PAT: only CENSYS_API_ID needed (Bearer). Legacy: both ID + SECRET required.
function censysConfigured(): boolean {
  if (CENSYS_API_ID.startsWith('censys_')) return true;
  return !!(CENSYS_API_ID && CENSYS_API_SECRET);
}

export async function GET(req: Request) {

  // 2. Validate the IP param.
  const { searchParams } = new URL(req.url);
  const ip = searchParams.get('ip')?.trim();
  if (!ip) {
    return NextResponse.json({ error: 'Missing ip parameter' }, { status: 400 });
  }

  // 3. Reject private/reserved/invalid targets (don't leak internal IPs to Censys).
  const guard = await validateHost(ip);
  if (!guard.ok) {
    return NextResponse.json(
      { error: 'IP blocked', detail: `Validation failed: ${guard.reason}` },
      { status: 403 }
    );
  }

  // 4. Serve from cache before rate-limiting — cache hits cost nothing upstream,
  //    so they shouldn't consume the per-client budget (a dashboard enriching
  //    many already-cached IPs would otherwise 429 itself).
  const cached = getCached(ip);
  if (cached) {
    return NextResponse.json({ ...cached, cached: true }, { headers: CACHE_HEADERS });
  }

  // 5. Rate limit only the lookups that actually hit Censys.
  if (isRateLimited(getClientIp(req), 10, 60_000)) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', detail: 'Maximum 10 lookups per minute.' },
      { status: 429 }
    );
  }

  // 6. Coalesce concurrent lookups for the same IP onto a single upstream request.
  let task = inflight.get(ip);
  if (!task) {
    task = censysConfigured() ? enrich(ip) : enrichFree(ip);
    inflight.set(ip, task);
  }

  try {
    const data = await task;
    setCached(ip, data);
    return NextResponse.json(data, { headers: CACHE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { error: 'IP intel lookup failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    );
  } finally {
    inflight.delete(ip);
  }
}
