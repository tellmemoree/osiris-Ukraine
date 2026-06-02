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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ip = searchParams.get('ip');

  if (!ip) {
    return NextResponse.json({ error: 'Missing IP parameter' }, { status: 400 });
  }

  const key = process.env.SHODAN_API_KEY;
  if (key) {
    const rich = await lookupViaKey(ip, key);
    if (rich) return NextResponse.json(rich);
  }

  try {
    const res = await fetch(`https://internetdb.shodan.io/${encodeURIComponent(ip)}`, {
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });

    if (res.status === 404) {
      return NextResponse.json({
        ip,
        status: 'No Shodan InternetDB records found',
        ports: [], cpes: [], hostnames: [], tags: [], vulns: [],
        source: 'internetdb',
      });
    }

    if (!res.ok) throw new Error(`Shodan HTTP ${res.status}`);

    const data = await res.json();
    return NextResponse.json({ ...data, source: 'internetdb' });
  } catch (error) {
    return NextResponse.json(
      { error: 'Shodan lookup failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    );
  }
}
