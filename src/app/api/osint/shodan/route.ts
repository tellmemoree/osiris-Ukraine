import { NextResponse } from 'next/server';

/**
 * OSIRIS — Shodan host lookup.
 *
 * Two tiers, picked automatically:
 *  - SHODAN_API_KEY set → /shodan/host/{ip}: richer per-host data (geo, ISP,
 *    org, open-service banners) on top of ports/vulns. Works on the free "oss"
 *    membership. NOTE: host *search* (discovery) needs a paid membership and is
 *    NOT used here.
 *  - no key (or key lookup fails) → keyless internetdb.shodan.io (ports, vulns,
 *    hostnames only).
 */

interface ShodanResult {
  ip: string;
  ports: number[];
  hostnames: string[];
  cpes: string[];
  tags: string[];
  vulns: string[];
  city?: string;
  country?: string;
  isp?: string;
  org?: string;
  lat?: number;
  lng?: number;
  services?: { port: number; transport?: string; product?: string }[];
  source: string;
  status?: string;
}

interface ShodanHostBanner { port?: number; transport?: string; product?: string }
interface ShodanHost {
  ip_str?: string;
  ports?: number[];
  hostnames?: string[];
  cpes?: string[];
  cpe?: string[];
  tags?: string[];
  vulns?: string[] | Record<string, unknown>;
  city?: string;
  country_name?: string;
  isp?: string;
  org?: string;
  latitude?: number;
  longitude?: number;
  data?: ShodanHostBanner[];
}

async function lookupViaKey(ip: string, key: string): Promise<ShodanResult | null> {
  try {
    const res = await fetch(
      `https://api.shodan.io/shodan/host/${encodeURIComponent(ip)}?key=${key}`,
      { signal: AbortSignal.timeout(9000), cache: 'no-store' }
    );
    if (!res.ok) return null; // 401/403/404 → fall back to InternetDB
    const h: ShodanHost = await res.json();
    const vulns = Array.isArray(h.vulns) ? h.vulns : h.vulns ? Object.keys(h.vulns) : [];
    return {
      ip: h.ip_str || ip,
      ports: h.ports || [],
      hostnames: h.hostnames || [],
      cpes: h.cpes || h.cpe || [],
      tags: h.tags || [],
      vulns,
      city: h.city,
      country: h.country_name,
      isp: h.isp,
      org: h.org,
      lat: h.latitude,
      lng: h.longitude,
      services: (h.data || [])
        .filter((d) => typeof d.port === 'number')
        .slice(0, 25)
        .map((d) => ({ port: d.port as number, transport: d.transport, product: d.product })),
      source: 'shodan/host',
    };
  } catch {
    return null;
  }
}

// ── 6-hour result cache (keyed by IP) + inflight coalescing ──
// Shodan's free "oss" membership has tight query limits, and the dashboard may
// request the same host repeatedly; cache results for 6h and coalesce concurrent
// lookups so each host costs at most one upstream call per window.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const MAX_CACHE_ENTRIES = 500;
const cache = new Map<string, { data: ShodanResult; at: number }>();
const inflight = new Map<string, Promise<ShodanResult>>();
const CACHE_HEADERS = { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=43200' };

function getCached(ip: string): ShodanResult | null {
  const hit = cache.get(ip);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  if (hit) cache.delete(ip);
  return null;
}

function setCached(ip: string, data: ShodanResult): void {
  // Bound memory: Map preserves insertion order, so the first key is the oldest.
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(ip, { data, at: Date.now() });
}

// Resolve a host via the key → InternetDB fallback chain. Returns a normalized
// result (including the cacheable "no records" case); throws only on a hard
// upstream failure so transient errors are never cached.
async function resolveHost(ip: string): Promise<ShodanResult> {
  const key = process.env.SHODAN_API_KEY;
  if (key) {
    const rich = await lookupViaKey(ip, key);
    if (rich) return rich;
  }

  const res = await fetch(`https://internetdb.shodan.io/${encodeURIComponent(ip)}`, {
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  });

  if (res.status === 404) {
    return {
      ip,
      status: 'No Shodan InternetDB records found',
      ports: [], cpes: [], hostnames: [], tags: [], vulns: [],
      source: 'internetdb',
    };
  }

  if (!res.ok) throw new Error(`Shodan HTTP ${res.status}`);

  const data = await res.json();
  return { ...data, ip: data.ip || ip, source: 'internetdb' };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ip = searchParams.get('ip');

  if (!ip) {
    return NextResponse.json({ error: 'Missing IP parameter' }, { status: 400 });
  }

  const cached = getCached(ip);
  if (cached) {
    return NextResponse.json({ ...cached, cached: true }, { headers: CACHE_HEADERS });
  }

  // Coalesce concurrent lookups for the same IP onto a single upstream request.
  let task = inflight.get(ip);
  if (!task) {
    task = resolveHost(ip);
    inflight.set(ip, task);
  }

  try {
    const data = await task;
    setCached(ip, data);
    return NextResponse.json(data, { headers: CACHE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { error: 'Shodan lookup failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    );
  } finally {
    inflight.delete(ip);
  }
}
