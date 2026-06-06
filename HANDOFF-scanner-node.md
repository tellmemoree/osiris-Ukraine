# Osiris — External Scanner Node Backlog

Active probing tools (traceroute, port scan, SSL connect, Nuclei) must NOT run
inline on the Osiris server — outbound connections are logged at the target and
trace back to the server's IP. This doc captures the full spec for a dedicated
scanner microservice on separate external infrastructure.

Last updated: 2026-06-06

---

## Background

The current `/api/scanner` route runs several scan types inline:
- `quick` — TCP probes via `net.Socket`
- `ssl` — live `tls.connect()`
- `headers` — live `fetch()`
- `tech` — live page fetch + regex
- `traceroute` — `mtr` via `spawn()`
- `vuln` — stub (returns empty without Shodan paid tier)

All of these originate connections from the Osiris server IP. They need to move
to a cheap dedicated VPS on a different provider/region.

---

## Architecture

```
Browser → Osiris (:3001)
              │
              ├── passive types (subdomains, rdns, whois, geoloc)
              │   → crt.sh / rdap.org / ip-api.com  [inline, stays]
              │
              └── active types (quick, ssl, headers, tech, traceroute, vuln)
                  → POST https://<scanner-node>:3002/scan
                      Authorization: Bearer SCANNER_KEY
                          │
                          ├── net.Socket  (TCP probe)
                          ├── tls.connect (SSL)
                          ├── fetch       (headers / tech)
                          ├── mtr         (traceroute)
                          └── nuclei      (vuln)
```

---

## What moves vs stays

| Scan type | Location | Reason |
|-----------|----------|--------|
| `quick` (TCP probes) | **Scanner node** | TCP SYN logged at target |
| `ssl` (live TLS) | **Scanner node** | TLS handshake logged at target |
| `headers` (live HTTP) | **Scanner node** | HTTP request logged at target |
| `tech` live-fetch part | **Scanner node** | HTTP request logged at target |
| `traceroute` | **Scanner node** | ICMP/UDP probes, definitively traceable |
| `vuln` (Nuclei) | **Scanner node** | Active scanning |
| `subdomains` | Inline | Queries crt.sh, never touches target |
| `rdns` | Inline | DNS reverse query |
| `whois` | Inline | Queries rdap.org |
| `geoloc` | Inline | Queries ip-api.com |
| `tech` Shodan-banner part | Inline | We query Shodan's API, not the target |

---

## VPS requirements

| | |
|-|-|
| Provider | Hetzner CX22 (~€4.5/mo) or Vultr $6/mo — pick a different provider/region from Osiris |
| RAM | 2 GB minimum (Nuclei needs ~400–600 MB for template loading) |
| Disk | 20 GB (Nuclei templates ~600 MB after update) |
| OS | Ubuntu 22.04 LTS |
| Network | Outbound unrestricted; inbound only port 3002 from Osiris server IP + SSH from your IP |

---

## Scanner microservice spec

**Stack:** Node.js + Fastify. No database. Single process.

**File structure:**
```
scanner/
├── server.js
├── tools/
│   ├── traceroute.js   ← spawns mtr
│   ├── quick.js        ← TCP probes (same logic as current scanQuickNative)
│   ├── ssl.js          ← tls.connect (same as current scanSslNative)
│   ├── headers.js      ← fetch HEAD
│   ├── tech.js         ← fetch + TECH_SIGS regex
│   └── vuln.js         ← spawns nuclei, parses NDJSON output
├── ssrf-guard.js       ← copy of src/lib/ssrf-guard.ts logic
├── .env
└── package.json
```

**API — single endpoint:**
```
POST /scan
Authorization: Bearer <SCANNER_KEY>
Content-Type: application/json

{ "target": "example.com", "type": "traceroute" }
```
Response JSON shape matches the existing inline implementations exactly — no
Osiris response-parsing changes needed.

**Auth:** Pre-shared key, Bearer header. Constant-time compare. Reject 401 immediately.

**Rate limiting:** 10 req/min per calling IP (safety rail; Osiris is the only caller).

**SSRF guard:** Validate and reject RFC1918, loopback, and link-local on the scanner
node independently — defence in depth even though Osiris validates first.

**Nuclei invocation:**
```bash
nuclei -u <target> \
  -tags cve,misconfig,default-login,exposed-panels \
  -severity medium,high,critical \
  -timeout 5 \
  -rate-limit 10 \
  -json \
  -silent
```
Parse stdout as newline-delimited JSON. Hard-timeout the full spawn at 120s.

---

## Tool installation on VPS

```bash
# System tools
apt update && apt install -y mtr-tiny curl unzip nodejs npm

# Nuclei binary (prebuilt, no Go needed)
curl -sL https://github.com/projectdiscovery/nuclei/releases/latest/download/nuclei_linux_amd64.zip \
  -o /tmp/nuclei.zip
unzip /tmp/nuclei.zip -d /usr/local/bin/
chmod +x /usr/local/bin/nuclei

# Pull template library (~600 MB — run once, then keep updated via cron)
nuclei -update-templates

# Process manager
npm install -g pm2
```

---

## Osiris-side changes

**New env vars** (`.env` + `.env.example`):
```
SCANNER_URL=http://<vps-ip>:3002
SCANNER_KEY=<random-256bit-secret>   # same value set on the scanner node
```

**`/api/scanner/route.ts` changes:**
- Add `proxyToScanner(target, type)` — POSTs to `SCANNER_URL/scan` with Bearer auth,
  returns the JSON response directly.
- Add `ACTIVE_TYPES` and `PASSIVE_TYPES` sets:
  ```ts
  const ACTIVE_TYPES  = new Set(['quick','ssl','headers','tech','vuln','traceroute']);
  const PASSIVE_TYPES = new Set(['subdomains','rdns','whois','geoloc']);
  ```
- Switch logic: `ACTIVE_TYPES` → proxy if `SCANNER_URL` set, else 503
  `"Active scanning requires the scanner node — set SCANNER_URL in .env"`.
  `PASSIVE_TYPES` → always inline.
- Shodan `fetchShodanHost` stays on Osiris side and augments inline passive results.
- Remove the now-dead inline implementations of the active types once the node is live.

**NVD fallback for `vuln` without scanner node:**

When `SCANNER_URL` is not set and `type=vuln`: run the tech scan inline (Shodan
banners + page fetch), then query NVD API for each detected product/version:
```
GET https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=<product>
```
Return CVEs with CVSS scores. Lower fidelity than Nuclei but fully passive, no
scanner node required, and better than an empty response.

---

## Security hardening

**VPS firewall (ufw):**
```bash
ufw default deny incoming
ufw allow from <osiris-server-ip> to any port 3002
ufw allow from <your-ip> to any port 22
ufw enable
```

**Scanner service:**
- Bind to specific interface if possible (not 0.0.0.0 if avoidable)
- `spawn()` with array args only — no shell string interpolation
- SSRF guard runs before any tool invocation

---

## Implementation checklist

### Infrastructure
- [ ] Provision VPS (Ubuntu 22.04, 2 GB RAM, different provider/region from Osiris)
- [ ] Configure UFW (port 3002 from Osiris IP only)
- [ ] Install mtr, Node, npm, pm2
- [ ] Install Nuclei binary + run `nuclei -update-templates`

### Scanner microservice
- [ ] Write `server.js` (Fastify, auth middleware, rate limiter, SSRF guard)
- [ ] Port `scanQuickNative` → `tools/quick.js`
- [ ] Port `scanSslNative` → `tools/ssl.js`
- [ ] Port `scanHeadersNative` → `tools/headers.js`
- [ ] Port tech live-fetch → `tools/tech.js`
- [ ] Port mtr spawn → `tools/traceroute.js`
- [ ] Write `tools/vuln.js` (Nuclei spawn + NDJSON parser)
- [ ] Copy SSRF guard logic → `ssrf-guard.js`
- [ ] Set `SCANNER_KEY` in `.env`, start with pm2
- [ ] Set up `nuclei -update-templates` cron (weekly)

### Osiris changes
- [ ] Add `SCANNER_URL` + `SCANNER_KEY` to `.env` and `.env.example`
- [ ] Update `/api/scanner/route.ts` — proxy active types, NVD fallback for vuln
- [ ] Remove now-dead inline active scan implementations
- [ ] Update `ARCHITECTURE.md` with scanner node section

### Verification
- [ ] Hit `traceroute` from OsintPanel — confirm response IP is scanner node
- [ ] Hit `vuln` — confirm Nuclei findings appear
- [ ] Hit `subdomains`/`whois` — confirm still works without scanner node
- [ ] Confirm `vuln` NVD fallback works when `SCANNER_URL` is unset
