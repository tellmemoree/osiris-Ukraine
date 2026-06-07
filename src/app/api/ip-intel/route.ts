import { NextResponse } from 'next/server';
import { validateHost, isRateLimited, getClientIp } from '@/lib/ssrf-guard';

/**
 * OSIRIS — IP intelligence enrichment via Censys Platform API v3.
 *
 * Passive host enrichment (ASN, geo, open services, TLS certs) for a single IP.
 * Endpoint: GET https://api.platform.censys.io/v3/global/asset/host/{host_id}
 * Auth: Bearer <PAT>  (PAT prefix: censys_*)
 * Response envelope: body.result.resource  (NOT body.result as the old Search v3 used)
 *
 * Configure in .env:  CENSYS_API_ID=censys_...  (PAT — CENSYS_API_SECRET not needed)
 * Without it the route falls back to ipinfo.io + Shodan InternetDB (keyless).
 * Results are cached 6h to stay within the free monthly credit allowance.
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

// Censys Platform API v3 — Host response shapes.
// Envelope: body.result.resource (Platform API); legacy Search v3 used body.result directly.
interface CensysService {
  port?: number;
  protocol?: string;         // service identifier (e.g. "HTTP", "TLS/HTTPS")
  transport_protocol?: string;
  cert?: {
    fingerprint_sha256?: string;
    fingerprint_sha1?: string;
  };
  scan_time?: string;        // ISO-8601; used to derive host last_updated
}

interface CensysHostResource {
  ip?: string;
  location?: {
    country?: string;
    city?: string;
    coordinates?: { latitude?: number; longitude?: number };
  };
  autonomous_system?: {
    asn?: number;
    name?: string;
    description?: string;
    bgp_prefix?: string;
  };
  services?: CensysService[];
  labels?: string[];
  greynoise?: {
    actor?: string;
    classification?: string;
    last_observed_time?: string;
    tags?: string[];
  };
  reputation?: { score?: number; score_level?: string };
  service_count?: number;
}

interface CensysHost {
  result?: {
    resource?: CensysHostResource;
  };
}

// ── 6-hour result cache (keyed by IP) + inflight coalescing ──
// Conserves the free Censys credit allowance: repeated dashboard lookups for the
// same host cost at most one upstream call per 6h window.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
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

// Bearer for PAT (censys_* prefix); Basic for legacy api_id + api_secret pairs.
function censysAuthHeader(): string {
  if (CENSYS_API_ID.startsWith('censys_')) {
    return `Bearer ${CENSYS_API_ID}`;
  }
  return `Basic ${Buffer.from(`${CENSYS_API_ID}:${CENSYS_API_SECRET}`).toString('base64')}`;
}

// Query Censys and normalize. Throws on hard upstream failure so transient
// errors are not cached; 404 (host not indexed) is a cacheable empty result.
async function enrich(ip: string): Promise<IpIntel> {
  const res = await fetch(
    `https://api.platform.censys.io/v3/global/asset/host/${encodeURIComponent(ip)}`,
    {
      headers: {
        Authorization: censysAuthHeader(),
        Accept: 'application/vnd.censys.api.v3.host.v1+json',
      },
      signal: AbortSignal.timeout(9000),
      cache: 'no-store',
    }
  );

  if (res.status === 404) {
    return { ip, status: 'No Censys records found', services: [], certs: [], source: 'censys' };
  }
  if (res.status === 401 || res.status === 403) {
    // Auth failed — silently fall back to free sources rather than hard-erroring.
    return enrichFree(ip);
  }
  if (!res.ok) throw new Error(`Censys HTTP ${res.status}`);

  const body = (await res.json()) as CensysHost;
  // Platform API wraps the host under result.resource (not result directly).
  const r = body.result?.resource ?? {};

  const services = (r.services ?? [])
    .filter((s) => typeof s.port === 'number')
    .slice(0, 50)
    .map((s) => ({ port: s.port as number, name: s.protocol, transport: s.transport_protocol }));

  // Platform API: cert fingerprint lives in s.cert.fingerprint_sha256 (not s.certificate string).
  const certs = Array.from(
    new Set(
      (r.services ?? [])
        .map((s) => s.cert?.fingerprint_sha256)
        .filter((c): c is string => !!c)
    )
  ).slice(0, 25);

  // Derive last_updated from the most recent service scan_time.
  const scanTimes = (r.services ?? []).map((s) => s.scan_time).filter((t): t is string => !!t);
  const last_updated = scanTimes.length > 0 ? scanTimes.sort().at(-1) : undefined;

  // Greynoise: prefer the community API (provides noise/riot booleans the UI uses for
  // "INTERNET SCANNER"/"KNOWN SERVICE" badges). Fall back to Censys-native greynoise
  // (actor + classification, no noise/riot) if the community call fails.
  const commGN = await fetchGreyNoise(ip).catch(() => undefined);
  let greynoise: GreyNoiseResult | undefined;
  if (commGN) {
    greynoise = commGN;
  } else if (r.greynoise) {
    const cgn = r.greynoise;
    greynoise = {
      noise: false,
      riot: false,
      classification: cgn.classification,
      name: cgn.actor,
      last_seen: cgn.last_observed_time,
    };
  }

  return {
    ip: r.ip || ip,
    asn: r.autonomous_system?.asn,
    as_name: r.autonomous_system?.name ?? r.autonomous_system?.description,
    country: r.location?.country,
    city: r.location?.city,
    lat: r.location?.coordinates?.latitude,
    lng: r.location?.coordinates?.longitude,
    services,
    certs,
    last_updated,
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
    return {
      noise: d.noise,
      riot: d.riot,
      classification: d.classification,
      name: d.name,
      link: d.link,
      last_seen: d.last_seen,
    };
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

  const { searchParams } = new URL(req.url);
  const ip = searchParams.get('ip')?.trim();
  if (!ip) {
    return NextResponse.json({ error: 'Missing ip parameter' }, { status: 400 });
  }

  // Reject private/reserved/invalid targets (don't leak internal IPs to Censys).
  const guard = await validateHost(ip);
  if (!guard.ok) {
    return NextResponse.json(
      { error: 'IP blocked', detail: `Validation failed: ${guard.reason}` },
      { status: 403 }
    );
  }

  // Serve from cache before rate-limiting — cache hits cost nothing upstream.
  const cached = getCached(ip);
  if (cached) {
    return NextResponse.json({ ...cached, cached: true }, { headers: CACHE_HEADERS });
  }

  // Rate limit only the lookups that actually hit Censys.
  if (isRateLimited(getClientIp(req), 10, 60_000)) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', detail: 'Maximum 10 lookups per minute.' },
      { status: 429 }
    );
  }

  // Coalesce concurrent lookups for the same IP onto a single upstream request.
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
