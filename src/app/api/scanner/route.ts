import { NextResponse } from 'next/server';
import { validateHost, isRateLimited, getClientIp, safeFetch } from '@/lib/ssrf-guard';
import { spawn } from 'node:child_process';
import * as dns from 'node:dns/promises';
import * as net from 'node:net';
import * as tls from 'node:tls';

const SHODAN_KEY = process.env.SHODAN_API_KEY || '';

// ── Shodan host data cache (same pattern as /api/osint/shodan) ──
// One upstream call per IP per 6h; scanner tabs share the same cached host object.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { data: ShodanHost; at: number }>();
const inflight = new Map<string, Promise<ShodanHost | null>>();

interface ShodanBanner {
  port?: number;
  transport?: string;
  product?: string;
  version?: string;
  cpe?: string[];
  ssl?: {
    cert?: {
      subject?: Record<string, string>;
      issuer?: Record<string, string>;
      issued?: string;
      expires?: string;
      fingerprint?: { sha256?: string; sha1?: string };
      extensions?: { name?: string; data?: string }[];
    };
    cipher?: { bits?: number; name?: string };
    versions?: string[];
  };
  http?: {
    title?: string;
    server?: string;
    headers?: Record<string, string>;
    status?: number;
    location?: string;
  };
}

interface ShodanHost {
  ip_str?: string;
  hostnames?: string[];
  ports?: number[];
  country_name?: string;
  city?: string;
  isp?: string;
  org?: string;
  latitude?: number;
  longitude?: number;
  vulns?: Record<string, { cvss?: number; summary?: string; references?: string[] }>;
  cpes?: string[];
  cpe?: string[];
  tags?: string[];
  data?: ShodanBanner[];
}

async function fetchShodanHost(ip: string): Promise<ShodanHost | null> {
  const hit = cache.get(ip);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  if (hit) cache.delete(ip);

  let task = inflight.get(ip);
  if (!task) {
    task = (async (): Promise<ShodanHost | null> => {
      try {
        const res = await fetch(
          `https://api.shodan.io/shodan/host/${encodeURIComponent(ip)}?key=${SHODAN_KEY}`,
          { signal: AbortSignal.timeout(9000), cache: 'no-store' }
        );
        if (!res.ok) return null;
        const data: ShodanHost = await res.json();
        if (cache.size >= 500) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        cache.set(ip, { data, at: Date.now() });
        return data;
      } catch {
        return null;
      }
    })();
    inflight.set(ip, task);
    task.finally(() => inflight.delete(ip));
  }
  return task;
}

// Resolve a hostname to its first IPv4 address, re-validating the address we
// actually got back. validateHost ran once in the GET handler, but the scan
// helpers resolve again before connecting — without re-checking, an attacker
// DNS server answering public→private on the second lookup (DNS rebinding /
// TOCTOU) would slip an internal IP past the guard. Re-validating the literal
// IP here (no second DNS round-trip — validateHost on an IP literal only does
// the blocklist check) pins every native connect to a vetted address.
async function resolveIp(hostname: string): Promise<string> {
  const ip = net.isIP(hostname) ? hostname : (await dns.lookup(hostname, { family: 4 })).address;
  const check = await validateHost(ip);
  if (!check.ok) throw new Error(`resolved IP blocked: ${check.reason}`);
  return ip;
}

// ── Scan implementations ──

async function scanQuick(hostname: string) {
  const ip = await resolveIp(hostname);
  const host = SHODAN_KEY ? await fetchShodanHost(ip) : null;

  if (host?.ports && host.ports.length > 0) {
    const bannersByPort = new Map<number, ShodanBanner>();
    for (const b of host.data ?? []) {
      if (typeof b.port === 'number') bannersByPort.set(b.port, b);
    }
    return {
      host: hostname,
      ip,
      scan_type: 'quick',
      ports: host.ports.map(port => {
        const b = bannersByPort.get(port);
        return { port, state: 'open', service: b?.product || guessService(port), version: b?.version };
      }),
      hostnames: host.hostnames,
      country: host.country_name,
      isp: host.isp,
      source: 'shodan',
    };
  }

  // Fallback: TCP probe common ports when not in Shodan
  return scanQuickNative(hostname);
}

const COMMON_PORTS: [number, string][] = [
  [21,'ftp'],[22,'ssh'],[23,'telnet'],[25,'smtp'],[53,'dns'],
  [80,'http'],[110,'pop3'],[143,'imap'],[443,'https'],[445,'smb'],
  [587,'submission'],[993,'imaps'],[995,'pop3s'],[1433,'mssql'],
  [3306,'mysql'],[3389,'rdp'],[5432,'postgresql'],[5900,'vnc'],
  [6379,'redis'],[8080,'http-alt'],[8443,'https-alt'],[27017,'mongodb'],
];

function guessService(port: number): string {
  return COMMON_PORTS.find(([p]) => p === port)?.[1] ?? 'unknown';
}

function probePort(host: string, port: number, ms = 2500): Promise<boolean> {
  return new Promise(resolve => {
    const sock = new net.Socket();
    let done = false;
    const finish = (v: boolean) => { if (!done) { done = true; sock.destroy(); resolve(v); } };
    sock.setTimeout(ms);
    sock.on('connect', () => finish(true));
    sock.on('timeout', () => finish(false));
    sock.on('error', () => finish(false));
    sock.connect(port, host);
  });
}

async function scanQuickNative(hostname: string) {
  // Resolve to IP first — probePort connects to the IP, never the raw user-supplied hostname
  const ip = await resolveIp(hostname);
  const t0 = Date.now();
  const open: { port: number; state: string; service: string }[] = [];
  const BATCH = 11;
  for (let i = 0; i < COMMON_PORTS.length; i += BATCH) {
    const rows = await Promise.all(
      COMMON_PORTS.slice(i, i + BATCH).map(async ([port, service]) => ({
        port, service, state: (await probePort(ip, port)) ? 'open' : 'closed',
      }))
    );
    open.push(...rows.filter(r => r.state === 'open'));
  }
  return { host: hostname, scan_type: 'quick', ports: open, duration: `${((Date.now()-t0)/1000).toFixed(1)}s`, source: 'tcp-probe' };
}

async function scanSsl(target: string) {
  const hostname = target.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
  const ip = await resolveIp(hostname);
  const host = SHODAN_KEY ? await fetchShodanHost(ip) : null;
  const sslBanner = host?.data?.find(b => b.ssl && (b.port === 443 || b.port === 8443));

  if (sslBanner?.ssl?.cert) {
    const cert = sslBanner.ssl.cert;
    const sanExt = cert.extensions?.find(e => e.name === 'subjectAltName');
    const sans = sanExt?.data?.split(',').map(s => s.trim().replace(/^DNS:/, '')).filter(Boolean).slice(0, 30) ?? [];
    const versions = (sslBanner.ssl.versions ?? []).filter(v => !v.startsWith('-'));
    return {
      host: hostname,
      ip,
      valid: true,
      protocol: versions[versions.length - 1] ?? 'unknown',
      supported_versions: versions,
      cipher: sslBanner.ssl.cipher?.name,
      cipher_bits: sslBanner.ssl.cipher?.bits,
      subject: cert.subject?.CN ?? JSON.stringify(cert.subject ?? {}),
      issuer: cert.issuer?.O ?? cert.issuer?.CN ?? JSON.stringify(cert.issuer ?? {}),
      not_before: cert.issued,
      not_after: cert.expires,
      expires: cert.expires,
      sans,
      fingerprint: cert.fingerprint?.sha256 ?? cert.fingerprint?.sha1,
      source: 'shodan',
    };
  }

  // Fallback: live TLS connect — connect to the already-validated IP, not the
  // raw hostname (which tls.connect would re-resolve, reopening the rebinding window).
  return scanSslNative(hostname, ip);
}

async function scanSslNative(hostname: string, ip: string): Promise<Record<string, unknown>> {
  // rejectUnauthorized:false is deliberate — this function's purpose is to INSPECT
  // certificates on arbitrary hosts, including expired, self-signed, and mismatched ones.
  // Authorization error state is preserved and returned in the `authorized` field so the
  // caller can still distinguish a valid cert from an invalid one.
  // Connect by the vetted IP; keep servername=hostname so SNI + cert subject still match.
  const tlsOpts: tls.ConnectionOptions = {
    host: ip, port: 443, servername: hostname,
    rejectUnauthorized: false, // required to read certs on invalid/expired hosts
  };
  return new Promise((resolve, reject) => {
    const sock = tls.connect(tlsOpts, () => {
      try {
        const cert = sock.getPeerCertificate(true) as tls.DetailedPeerCertificate & { valid_from?: string; valid_to?: string };
        const protocol = sock.getProtocol() ?? 'unknown';
        const cipher = sock.getCipher() as { name?: string; version?: string; bits?: number } | null;
        const authorized = !sock.authorizationError;
        sock.end();
        const sans = ((cert as any).subjectaltname ?? '')
          .split(', ').filter(Boolean)
          .map((s: string) => s.replace(/^DNS:|^IP Address:/i, '')).slice(0, 30);
        const subj = cert.subject as Record<string, string> | null ?? {};
        const iss = cert.issuer as Record<string, string> | null ?? {};
        resolve({
          host: hostname, authorized, valid: authorized, protocol,
          cipher: cipher?.name, cipher_bits: cipher?.bits,
          subject: subj.CN ?? JSON.stringify(subj),
          issuer: iss.O ?? iss.CN ?? JSON.stringify(iss),
          not_before: cert.valid_from, not_after: cert.valid_to, expires: cert.valid_to,
          sans, fingerprint: (cert as any).fingerprint256 ?? cert.fingerprint,
          serial: cert.serialNumber, source: 'live-tls',
        });
      } catch (e) { sock.destroy(); reject(e); }
    });
    sock.setTimeout(10000);
    sock.on('timeout', () => { sock.destroy(); reject(new Error('TLS timeout')); });
    sock.on('error', reject);
  });
}

async function scanHeaders(target: string) {
  const hostname = target.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
  const ip = await resolveIp(hostname);
  const host = SHODAN_KEY ? await fetchShodanHost(ip) : null;
  const httpBanner = host?.data?.find(b => b.http && (b.port === 80 || b.port === 443 || b.port === 8080 || b.port === 8443));

  if (httpBanner?.http?.headers) {
    const h = httpBanner.http;
    const headers = h.headers ?? {};
    const secKeys = ['strict-transport-security','content-security-policy','x-frame-options','x-content-type-options','referrer-policy','permissions-policy','x-xss-protection'];
    const security: Record<string, string | null> = {};
    for (const k of secKeys) security[k] = headers[k] ?? null;
    return {
      target: hostname, ip, status: h.status, title: h.title,
      headers, security_headers: security,
      missing_security: secKeys.filter(k => !security[k]),
      source: 'shodan',
    };
  }

  // Fallback: live HTTP fetch — use validated hostname, not raw target
  return scanHeadersNative(hostname);
}

async function scanHeadersNative(hostname: string) {
  const url = `https://${hostname}`;
  // safeFetch follows redirects manually and re-validates every hop, so a
  // public host can't 30x-redirect us onto an internal target.
  let res: Response;
  try {
    res = await safeFetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
  } catch {
    res = await safeFetch(url, { signal: AbortSignal.timeout(8000) });
  }
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  const secKeys = ['strict-transport-security','content-security-policy','x-frame-options','x-content-type-options','referrer-policy','permissions-policy','x-xss-protection'];
  const security: Record<string, string | null> = {};
  for (const k of secKeys) security[k] = headers[k] ?? null;
  return {
    target: url, final_url: res.url, status: res.status, headers,
    security_headers: security, missing_security: secKeys.filter(k => !security[k]),
    source: 'live-fetch',
  };
}

const TECH_SIGS: [string, string, string][] = [
  ['WordPress','CMS','wp-content|wp-includes|wordpress'],
  ['Shopify','E-commerce','shopify|myshopify\\.com'],
  ['Wix','CMS','\\bwix\\.com\\b|\\bwixsite\\.com\\b'],
  ['Squarespace','CMS','squarespace\\.com|Static\\.SQUARESPACE'],
  ['Webflow','CMS','webflow\\.com|data-wf-site'],
  ['Ghost','CMS','\\bghost\\.io\\b|\\bcontent\\.ghost\\.org\\b'],
  ['React','JavaScript','react-dom|__REACT|data-reactroot'],
  ['Vue.js','JavaScript','__vue__|data-v-app'],
  ['Angular','JavaScript','ng-version|ng-app'],
  ['Next.js','JavaScript','__NEXT_DATA__|/_next/static'],
  ['Nuxt.js','JavaScript','__NUXT__|/_nuxt/'],
  ['jQuery','JavaScript','jquery\\.min\\.js|jQuery v'],
  ['Bootstrap','CSS Framework','bootstrap\\.min\\.css|bootstrap\\.min\\.js'],
  ['Tailwind CSS','CSS Framework','tailwindcss'],
  ['Cloudflare','CDN/Security','cf-ray|cloudflareinsights'],
  ['AWS CloudFront','CDN','cloudfront\\.net|x-amz-cf-id'],
  ['Google Analytics','Analytics','google-analytics\\.com|gtag\\(|UA-\\d+'],
  ['Google Tag Manager','Analytics','googletagmanager\\.com|GTM-'],
  ['Stripe','Payments','stripe\\.com/v3'],
  ['Sentry','Monitoring','sentry\\.io|Sentry\\.init'],
];

async function scanTech(target: string) {
  const hostname = target.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
  const ip = await resolveIp(hostname);
  const host = SHODAN_KEY ? await fetchShodanHost(ip) : null;

  const tech: { name: string; category: string; evidence: string }[] = [];

  if (host) {
    // Extract tech from Shodan banners
    const allCpes = [...(host.cpes ?? []), ...(host.cpe ?? [])];
    for (const banner of host.data ?? []) {
      if (banner.product && !tech.find(t => t.name === banner.product)) {
        tech.push({ name: `${banner.product}${banner.version ? ' ' + banner.version : ''}`, category: 'Software', evidence: `Shodan banner port ${banner.port}` });
      }
      if (banner.http?.server && !tech.find(t => t.name === banner.http!.server)) {
        tech.push({ name: banner.http.server!, category: 'Web Server', evidence: 'Server banner' });
      }
    }
    for (const cpe of allCpes) {
      const parts = cpe.replace('cpe:/', '').replace('cpe:2.3:', '').split(':');
      const vendor = parts[2] ?? '', product = parts[3] ?? '';
      if (product && !tech.find(t => t.name.toLowerCase().includes(product))) {
        tech.push({ name: `${vendor}/${product}`, category: 'CPE', evidence: 'Shodan CPE' });
      }
    }
  }

  // Augment / fallback with live page analysis — use validated hostname, not raw target
  try {
    const url = `https://${hostname}`;
    // safeFetch re-validates each redirect hop — a public host can't bounce us
    // to an internal target (cloud metadata, localhost services, RFC1918).
    const res = await safeFetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OSIRIS-OSINT/1.0)' },
    });
    const pageHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => { pageHeaders[k] = v; });
    const body = await res.text();
    const corpus = body + JSON.stringify(pageHeaders);
    if (pageHeaders['x-powered-by'] && !tech.find(t => t.name === pageHeaders['x-powered-by'])) {
      tech.push({ name: pageHeaders['x-powered-by'], category: 'Framework', evidence: 'X-Powered-By header' });
    }
    const gen = body.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i);
    if (gen && !tech.find(t => t.name === gen[1])) {
      tech.push({ name: gen[1], category: 'CMS', evidence: 'meta generator' });
    }
    for (const [name, category, pattern] of TECH_SIGS) {
      if (new RegExp(pattern, 'i').test(corpus) && !tech.find(t => t.name === name)) {
        tech.push({ name, category, evidence: 'pattern match' });
      }
    }
    return { target: hostname, ip, final_url: res.url, status: res.status, technologies: tech, tech_count: tech.length, source: host ? 'shodan+live' : 'live' };
  } catch {
    return { target: hostname, ip, technologies: tech, tech_count: tech.length, source: 'shodan' };
  }
}

async function scanVuln(target: string) {
  const hostname = target.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
  const ip = await resolveIp(hostname);
  if (!SHODAN_KEY) {
    return { target: hostname, ip, error: 'Shodan API key required for vulnerability data', vulnerabilities: [] };
  }
  const host = await fetchShodanHost(ip);
  if (!host?.vulns || Object.keys(host.vulns).length === 0) {
    return { target: hostname, ip, vulnerabilities: [], risk_level: 'NONE', source: 'shodan' };
  }
  const vulns = Object.entries(host.vulns).map(([id, v]) => ({
    id, cvss: v.cvss, description: v.summary,
    severity: v.cvss == null ? 'UNKNOWN' : v.cvss >= 9 ? 'CRITICAL' : v.cvss >= 7 ? 'HIGH' : v.cvss >= 4 ? 'MEDIUM' : 'LOW',
  })).sort((a, b) => (b.cvss ?? 0) - (a.cvss ?? 0));
  const maxCvss = vulns[0]?.cvss ?? 0;
  const risk_level = maxCvss >= 9 ? 'CRITICAL' : maxCvss >= 7 ? 'HIGH' : maxCvss >= 4 ? 'MEDIUM' : 'LOW';
  return { target: hostname, ip, vulnerabilities: vulns, risk_level, source: 'shodan' };
}

async function scanSubdomains(domain: string) {
  const clean = domain.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
  const res = await fetch(`https://crt.sh/?q=%25.${encodeURIComponent(clean)}&output=json`, {
    signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`crt.sh returned ${res.status}`);
  const data: { name_value?: string }[] = await res.json();
  const subs = new Set<string>();
  for (const entry of data) {
    for (const name of (entry.name_value ?? '').split('\n')) {
      const n = name.trim().toLowerCase().replace(/^\*\./, '');
      if (n && n.endsWith(clean) && n !== clean) subs.add(n);
    }
  }
  const sorted = [...subs].sort((a, b) => a.split('.').length - b.split('.').length || a.localeCompare(b));
  return { domain: clean, subdomains: sorted.slice(0, 200), total: sorted.length, source: 'crt.sh' };
}

async function scanRdns(target: string) {
  const hostname = target.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
  const ip = await resolveIp(hostname);
  const host = SHODAN_KEY ? await fetchShodanHost(ip) : null;

  let ptrs: string[] = host?.hostnames ?? [];
  let source = ptrs.length > 0 ? 'shodan' : 'dns';

  if (ptrs.length === 0) {
    try { ptrs = await dns.reverse(ip); } catch { ptrs = []; }
    if (ptrs.length === 0) source = 'none';
  }

  return { host: hostname, ip, ptr_records: ptrs, source };
}

async function scanWhois(target: string) {
  const hostname = target.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
  const isIp = net.isIP(hostname) > 0;
  const ip = isIp ? hostname : await resolveIp(hostname);
  const host = SHODAN_KEY ? await fetchShodanHost(ip) : null;

  const rdapTarget = isIp ? ip : hostname;
  const rdapType = isIp ? 'ip' : 'domain';
  const rdapRes = await fetch(
    `https://rdap.org/${rdapType}/${encodeURIComponent(rdapTarget)}`,
    { signal: AbortSignal.timeout(12000), headers: { Accept: 'application/rdap+json' } }
  );
  if (!rdapRes.ok) throw new Error(`RDAP returned ${rdapRes.status}`);
  const r = await rdapRes.json() as Record<string, unknown>;

  const entities = (r.entities as Record<string, unknown>[] | undefined) ?? [];
  const vcardName = (e: Record<string, unknown>) => {
    const arr = (e.vcardArray as unknown[][])?.[1] as unknown[][] | undefined;
    return (arr?.find(v => v[0] === 'fn') as unknown[] | undefined)?.[3] as string | undefined;
  };
  const registrar  = entities.find(e => (e.roles as string[])?.includes('registrar'));
  const registrant = entities.find(e => (e.roles as string[])?.includes('registrant'));

  if (isIp) {
    const cidrs = r.cidr0_cidrs as { v4prefix?: string; v6prefix?: string; length?: number }[] | undefined;
    const cidr = cidrs?.[0]
      ? `${cidrs[0].v4prefix ?? cidrs[0].v6prefix}/${cidrs[0].length}`
      : undefined;
    return {
      host: hostname, ip,
      network_name: r.name,
      network_handle: r.handle,
      start_address: r.startAddress,
      end_address: r.endAddress,
      cidr,
      country: r.country,
      isp: host?.isp ?? host?.org,
      events: (r.events as { eventAction: string; eventDate: string }[] | undefined)
        ?.map(e => ({ action: e.eventAction, date: e.eventDate })),
      source: 'rdap' + (host ? '+shodan' : ''),
    };
  }

  const events = r.events as { eventAction: string; eventDate: string }[] | undefined;
  return {
    host: hostname, ip,
    domain: r.ldhName ?? hostname,
    status: r.status ?? [],
    registrar: registrar ? vcardName(registrar) : undefined,
    registrant: registrant ? vcardName(registrant) : undefined,
    registered: events?.find(e => e.eventAction === 'registration')?.eventDate,
    expires: events?.find(e => e.eventAction === 'expiration')?.eventDate,
    nameservers: (r.nameservers as { ldhName: string }[] | undefined)?.map(ns => ns.ldhName),
    source: 'rdap',
  };
}

async function scanGeoloc(target: string) {
  const hostname = target.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
  const ip = await resolveIp(hostname);
  const host = SHODAN_KEY ? await fetchShodanHost(ip) : null;

  if (host?.latitude != null) {
    return {
      host: hostname, ip,
      latitude: host.latitude, longitude: host.longitude,
      country: host.country_name, city: host.city,
      isp: host.isp, org: host.org,
      source: 'shodan',
    };
  }

  const res = await fetch(
    `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,regionName,city,lat,lon,isp,org,as,timezone`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!res.ok) throw new Error('geoloc lookup failed');
  const d = await res.json() as Record<string, unknown>;
  if (d.status !== 'success') throw new Error((d.message as string) || 'geoloc lookup failed');
  return {
    host: hostname, ip,
    latitude: d.lat, longitude: d.lon,
    country: d.country, region: d.regionName, city: d.city,
    timezone: d.timezone, isp: d.isp, org: d.org, asn: d.as,
    source: 'ip-api',
  };
}

// SSRF guard already validated the hostname before this is called. spawn() is used
// (not shell exec) so there is no injection risk from the hostname argument.
async function scanTraceroute(target: string): Promise<Record<string, unknown>> {
  const hostname = target.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
  // Resolve+validate first and trace to the vetted IP so mtr can't re-resolve
  // the name to an internal address.
  const ip = await resolveIp(hostname);
  return new Promise((resolve, reject) => {
    // 2 cycles, 20 hops max, numeric output — typically completes in 15-25s
    const proc = spawn('mtr', ['--report', '--report-cycles', '2', '--no-dns', '--max-ttl', '20', ip]);
    let out = '', err = '';
    const timer = setTimeout(() => { proc.kill(); reject(new Error('traceroute timed out after 30s')); }, 30000);

    proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) return reject(new Error(err.trim() || `mtr exited ${code}`));

      // MTR report format: "  1.|-- 1.2.3.4   0.0%   2   1.1   1.0   0.9   1.1   0.0"
      //   fields:           hop  host         loss%  snt last  avg   best  wrst  stdev
      const hops: { hop: number; hostname: string; loss: string; avg: string; best: string; worst: string }[] = [];
      for (const line of out.split('\n')) {
        const m = line.match(/^\s*(\d+)\.\|--\s+(\S+)\s+([\d.]+%)\s+\d+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
        if (m) hops.push({ hop: +m[1], hostname: m[2], loss: m[3], avg: `${m[4]}ms`, best: `${m[5]}ms`, worst: `${m[6]}ms` });
      }
      resolve({ host: hostname, hops, hop_count: hops.length, raw: out, source: 'mtr' });
    });
  });
}

// deep/ports/banner remain blocked (active scan DDoS-amplifier risk).
// traceroute is now permitted — runs on hackertarget infra, not locally.
const BLOCKED_TYPES = new Set(['deep', 'ports', 'banner']);
const ALLOWED_TYPES = new Set(['quick', 'ssl', 'headers', 'subdomains', 'tech', 'vuln', 'rdns', 'whois', 'geoloc', 'traceroute']);

export async function GET(req: Request) {
  const clientIp = getClientIp(req);
  if (isRateLimited(clientIp, 5, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded', detail: 'Maximum 5 scans per minute.' }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const target = searchParams.get('target')?.trim();
  const scanType = searchParams.get('type') || 'quick';

  if (!target) return NextResponse.json({ error: 'Missing target parameter' }, { status: 400 });
  if (BLOCKED_TYPES.has(scanType)) {
    return NextResponse.json({ error: 'Scan type restricted', detail: `"${scanType}" is disabled for safety.` }, { status: 403 });
  }
  if (!ALLOWED_TYPES.has(scanType)) {
    return NextResponse.json({ error: 'Unknown scan type', detail: 'Available: quick, ssl, headers, subdomains, tech, vuln' }, { status: 400 });
  }

  const hostname = target.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
  const guard = await validateHost(hostname);
  if (!guard.ok) {
    return NextResponse.json({ error: 'Target blocked', detail: guard.reason }, { status: 403 });
  }

  try {
    let result: unknown;
    switch (scanType) {
      case 'quick':      result = await scanQuick(hostname); break;
      case 'ssl':        result = await scanSsl(target); break;
      case 'headers':    result = await scanHeaders(target); break;
      case 'subdomains': result = await scanSubdomains(target); break;
      case 'tech':       result = await scanTech(target); break;
      case 'vuln':       result = await scanVuln(target); break;
      case 'rdns':       result = await scanRdns(target); break;
      case 'whois':      result = await scanWhois(target); break;
      case 'geoloc':     result = await scanGeoloc(target); break;
      case 'traceroute': result = await scanTraceroute(target); break;
      default:
        return NextResponse.json({ error: `Scan type "${scanType}" not yet implemented` }, { status: 501 });
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: 'Scan failed', detail: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
