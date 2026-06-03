# Osiris — Recon Toolkit Setup + Russia Camera Expansion Handoff

Branch: `osiris-Ukraine`  
Last updated: 2026-05-31

---

## Part 1 — Recon Toolkit Setup

### Tools to integrate / install

| Tool | Purpose | Status |
|------|---------|--------|
| **Shodan** | Internet-facing device scanning | Partially wired (`/api/shodan-sweep`) — needs `SHODAN_API_KEY` in `.env` |
| **Censys** | Alternative to Shodan; better cert data | Not started — `CENSYS_API_ID` + `CENSYS_API_SECRET` needed |
| **SpiderFoot** | Automated OSINT across 200+ modules | Docker available: `ghcr.io/smicallef/spiderfoot` |
| **theHarvester** | Email / subdomain / host enumeration | CLI only — no web API to wire in yet |
| **Recon-ng** | Modular recon framework with workspace management | CLI only |
| **Maltego** | Link-analysis graph (Community free tier) | Desktop client — no API |
| **DNSdumpster** | Passive DNS / subdomain discovery | REST-style API, no auth key needed |
| **OSINT Framework** | Curated link tree | Reference only — `https://osintframework.com` |
| **Wigle.net** | WiFi network geolocation | `WIGLE_API_KEY` → future layer idea |

### Shodan sweep — ✅ caching DONE (2026-06-03)

`/api/osint/shodan` (host lookup) and `/api/osint/sweep` are the live routes (the
old `/api/shodan-sweep` path in earlier notes is stale). The sweep already moved
client-side to dodge the EPYC IP rate-limit.

**✅ Server-side result caching implemented** (commit `e18fd50`): a 6-hour in-memory
cache keyed by IP with inflight coalescing (bounded to 500 entries) + a
`Cache-Control: s-maxage=21600, stale-while-revalidate=43200` header, so repeated
dashboard loads for the same host cost at most one upstream call per 6h window.
Transient failures are never cached. (In-memory rather than Redis/KV — matches the
codebase's existing `kab-threats` pattern and needs no extra infra.)

`SHODAN_API_KEY` is set in the gitignored `.env` (free `oss` tier — host lookup
works; host *search*/discovery still needs a paid membership, see HANDOFF.md #7).

### Censys integration — ✅ scaffold DONE, ⚠️ needs key to activate (2026-06-03)

Censys is better than Shodan for: TLS certificate transparency, IPv6 coverage,
host history.

**✅ Route built** (`src/app/api/ip-intel/route.ts`, commit `e18fd50`):
- `GET /api/ip-intel?ip=` — passive enrichment, NOT active scanning (queries the
  Censys index, never connects to the target).
- Censys Search v2 host endpoint (`https://search.censys.io/api/v2/hosts/{ip}`),
  HTTP Basic auth. Normalizes ASN, geo (lat/lng/country/city), open services
  (port/name/transport), and TLS cert fingerprints.
- Same 6h cache + coalescing as Shodan; SSRF-guarded IP input (rejects
  private/reserved via `validateHost`); rate-limited 10/min.
- Returns **503 "Censys not configured"** until creds are present (mirrors
  `/api/scanner`). Verified end-to-end on dev (:3001).

> ⚠️ **TO ACTIVATE — paste your Censys key:** open the gitignored **`.env`** and fill in
> the two placeholders already waiting there:
> ```
> CENSYS_API_ID=<your id>
> CENSYS_API_SECRET=<your secret>
> ```
> Get both (free tier, ~10k credits/mo) at https://search.censys.io/account/api,
> then restart the dev server. The route flips from 503 to live enrichment.

**Still TODO (frontend):** add the `ip-intel-dots` map layer for geolocated IPs —
the API is ready; nothing consumes it on the map yet.

### SpiderFoot Docker (next session)

```bash
docker run -d -p 5001:5001 \
  -e "SF_MODULES=sfp_shodan,sfp_censys,sfp_whois,sfp_dns,sfp_email" \
  ghcr.io/smicallef/spiderfoot
```

Access at `http://localhost:5001`. Create a workspace for a target domain, export results as JSON, pipe into Osiris layers.

---

## Part 2 — Russia Camera Network Expansion

### Goal
Add open-source, publicly accessible camera feeds from Russia to the CCTV layer in Osiris. These are cameras with no login required, indexing existing open sources only.

### Verified open sources

| Source | Type | Coverage | Status |
|--------|------|----------|--------|
| **insecam.org/en/bycountry/RU/** | Aggregated exposed CCTV | Russia-wide | ✅ Verified open, no auth |
| **Windy.com webcams** | Weather/traffic cams | Russia-wide | ✅ API available — see below |
| **YouTube live channels** | Broadcaster streams | Moscow, St. Pete | ✅ Embeddable |
| **rucams.ru** | Russian webcam directory | Russia-wide | ⚠ Verify availability |
| **deptrans.mos.ru** | Moscow traffic dept cams | Moscow only | ⚠ Some require VPN |
| **Yandex Maps panoramas** | 360° imagery (not live) | Russia-wide | ✅ No auth, not realtime |

### Windy webcam API (recommended first step)

Windy aggregates thousands of public webcams globally. Ukraine already uses this.

**Russia bounding box:** `lat_min=41.0, lat_max=82.0, lon_min=19.0, lon_max=190.0`

Endpoint to add in `/api/cameras/route.ts` (or a new `/api/cameras/russia.ts`):
```
https://api.windy.com/api/webcams/v2/list/nearby/{lat},{lon},{radius}?lang=en&show=webcams:location,image,player&key=WINDY_WEBCAM_KEY
```

Or bounding-box form:
```
https://api.windy.com/api/webcams/v2/list/bbox/{min_lat},{min_lon},{max_lat},{max_lon}?lang=en&show=webcams:location,image,player&key=WINDY_WEBCAM_KEY
```

Key: register at `https://api.windy.com/` (free tier = 500 req/day).

Add to `.env`:
```
WINDY_WEBCAM_KEY=<your key>
```

### YouTube live channels (Russia / border regions)

These are already the correct embed format (same as Ukrainian live feeds in `LiveAlerts.tsx`):

| Channel | Description | Channel ID |
|---------|-------------|------------|
| Russia-1 | State TV (propaganda — monitoring only) | `UCddiUEpeqJcYeBxX1IVBKvQ` |
| Moscow 24 | Moscow city news | `UCOX29nu5NRA4t0-F7uYDxOg` |
| RT (Russia Today) | English RT | `UCnUYZLuoy1rq1aVMwx4aTzw` |
| Dozhd TV (Rain TV) | Independent Russian opposition news (Riga-based) | `UCqIFM3FRW3BXDRE0m7wBPFg` |
| Belsat | Belarusian opposition media | various |

**Note:** RT and Russia-1 are state propaganda. Add to feeds list with `category: 'propaganda'` flag so operators know to treat critically.

### insecam.org integration

insecam.org is a directory of cameras with default/no passwords, indexed from Shodan. Scraping approach:

```ts
// In /api/cameras/russia.ts
const res = await fetch('http://www.insecam.org/en/bycountry/RU/?page=1', {
  headers: { 'User-Agent': '...' }
});
// Parse camera iframe src from HTML — returns MJPEG stream URLs
// Pattern: <img id="image0" src="http://<ip>:<port>/..." />
```

The feeds are MJPEG — not directly embeddable in YouTube iframe format. Consider adding a `stream_type: 'mjpeg'` support in `CameraViewer.tsx`.

### Next session plan

1. Add `WINDY_WEBCAM_KEY` to `.env`
2. Create `/api/cameras/russia.ts` with Windy bbox fetch for Russia
3. Add static list of Russian YouTube live channels to `BUILTIN_FEEDS` in `LiveAlerts.tsx` with `region: 'russia'` and `category: 'conflict'`
4. Consider: CameraViewer MJPEG support for insecam.org feeds

### City target list for camera seeding

Priority cities for camera search (military/strategic relevance):
- **Moscow** (Kremlin, Red Square, transport hubs)
- **St. Petersburg** (port, Baltic fleet)
- **Belgorod** (border city with Ukraine — active shelling zone)
- **Kursk** (Ukrainian cross-border operations ongoing)
- **Novorossiysk** (Black Sea Fleet port)
- **Sevastopol** (occupied, Black Sea Fleet HQ)
- **Mariupol** (occupied, strategic port)
- **Rostov-on-Don** (logistical hub for Russian forces)

---

## Files modified in this session

| File | Change |
|------|--------|
| `src/components/OsirisMap.tsx` | Disputed border hidden; oblast/district polygon fills added |
| `src/components/LiveAlerts.tsx` | UA WAR filter tab added; badge split UA/WORLD |
| `public/ukraine-oblasts.geojson` | 27 Ukraine oblast boundaries (OSM-derived, simplified) |
| `public/ukraine-districts.geojson` | 155 Ukraine rayon boundaries (OSM-derived, simplified) |

---

## Data sources used

- **OSM Overpass API** — `overpass-api.de` — Ukraine admin boundaries (admin_level 4=oblast, 6=rayon)
- **vadimklimenko.com/map/statuses.json** — live air raid alerts (keyless)
- **aisstream.io** — AIS ship tracking (key: in `.env`)
