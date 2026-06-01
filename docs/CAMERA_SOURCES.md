# Adding camera sources to the CCTV layer

The map's **CCTV** layer is served by `src/app/api/cctv/route.ts`. This guide shows
how to add more cameras yourself — both intentionally-public feeds and
exposed/unsecured cameras.

## How the layer works

Each source is an `async` function returning an array of camera objects:

```ts
{
  id: string;        // unique, stable
  lat: number;       // marker latitude
  lng: number;       // marker longitude
  name: string;      // popup title
  city: string;
  country: string;
  feed_url: string;  // opened when the marker is clicked
  source: string;    // provenance label shown in the popup
}
```

Wire-up is three steps:

1. Write a `fetchXCameras()` function (curated array, or `fetch()` a real API and map it).
2. Register it in `REGION_FETCHERS` (`'myregion': fetchXCameras`).
3. Add a viewport rule in `getRegionsForBounds()` so it loads when that area is on screen.

`GET /api/cctv?region=all` loads every fetcher; `?region=russia,ukraine` loads
specific ones; with `lat`/`lng`/`radius` it auto-selects by viewport. Fetchers run
through `Promise.allSettled`, so a source that throws or returns `[]` is skipped
without breaking the layer. Markers render via the existing `cctv` layer in
`OsirisMap.tsx` — **no frontend changes are ever needed**, only this route.

`feed_url` can be anything the popup can open: a `.jpg`/MJPEG still, an HLS/RTSP
gateway URL, a YouTube embed, or a webcam directory page.

---

## 1. Public / official feeds (preferred — reliable + labelled)

Best signal-to-noise: government traffic APIs and city webcam directories. Pattern
for a live API (mirrors `fetchTfLCameras`):

```ts
async function fetchMoscowTrafficCameras(): Promise<any[]> {
  const res = await fetch('https://EXAMPLE-portal/api/cameras.json', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.cameras.map((c: any, i: number) => ({
    id: `msk-${c.id ?? i}`,
    lat: c.lat, lng: c.lon,
    name: c.title || 'Moscow traffic cam',
    city: 'Moscow', country: 'Russia',
    feed_url: c.image || c.stream,
    source: 'Moscow CODD',
  })).filter((c: any) => c.lat && c.lng && c.feed_url);
}
```

**Where to look for RU/UA public feeds** (verify each returns 200 before shipping —
several are geo-blocked from non-RU IPs, so test from the deploy host):

- Regional ЦОДД / traffic-monitoring portals (many publish open MJPEG/JSON).
- City "Безопасный город" / urban-monitoring public cams.
- `skylinewebcams.com/en/webcam/russia.html` and `.../ukraine.html` (directories — already pinned).
- `earthcam.com/world/russia/<city>/` (Moscow/Kyiv have dedicated pages today).
- Windy webcams (`api.windy.com/webcams`) — needs a free `WINDY_API_KEY`; returns
  lat/lng/title/preview per cam, ideal for clean markers. Add the key to `.env` and
  read it in the fetcher.

Curated-list pattern (no API), like the Ottawa block — just hardcode verified pins.

---

## 2. Exposed / unsecured cameras (do this yourself)

These are cameras reachable on the public internet that were **not** intended to be
public — default-credential or no-auth devices. They are noisy, unverified, and move
around, so they're kept out of the shipped layer. To add them, build a fetcher that
queries a discovery source and maps the hits into the same camera shape.

### Option A — Shodan (recommended; needs a paid `SHODAN_API_KEY`)

The free keyless `internetdb.shodan.io` used by `osint/shodan/route.ts` has no host
search. A full key unlocks geo + service search:

```ts
async function fetchExposedCamerasRU(): Promise<any[]> {
  const key = process.env.SHODAN_API_KEY;
  if (!key) return [];
  // Open RTSP/webcam services geolocated to Russia. Tune the query:
  //   has_screenshot:true country:RU port:554        → RTSP with a preview frame
  //   "Server: yawcam" / "Server: GeoVision" country:RU
  //   product:"hikvision" country:RU "200 OK"
  const q = encodeURIComponent('has_screenshot:true country:RU port:554');
  const res = await fetch(`https://api.shodan.io/shodan/host/search?key=${key}&query=${q}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.matches || [])
    .filter((m: any) => m.location?.latitude && m.location?.longitude)
    .map((m: any) => ({
      id: `shodan-${m.ip_str}-${m.port}`,
      lat: m.location.latitude, lng: m.location.longitude,
      name: m.org || m.product || 'Exposed camera',
      city: m.location.city || '', country: m.location.country_name || 'Russia',
      // RTSP isn't browser-playable; route through an HLS gateway (e.g. go2rtc /
      // MediaMTX) or just record the address for triage:
      feed_url: `rtsp://${m.ip_str}:${m.port}`,
      source: 'Shodan',
    }));
}
```

Useful Shodan dorks: `screenshot.label:cam country:RU`, `product:"Hikvision IP Camera" country:RU`,
`title:"Network Camera" country:RU`, `"RTSP/1.0 200" country:RU port:554`,
`"Server: GStreamer RTSP" country:RU`. Swap `country:RU` for `country:UA` or a
`geo:"lat,lng,radiuskm"` filter to focus on an oblast.

### Option B — Insecam mirror

`insecam.org` indexes no-auth cameras by country (`/en/bycountry/RU/`). It's an HTML
scrape (no API): pull the `<img src>` thumbnails and the per-camera detail pages,
which expose the direct device URL and an approximate city. Expect heavy churn —
re-scrape on a TTL and drop dead entries.

### Playing the streams

Most exposed devices speak **RTSP**, which browsers can't play directly. Stand up a
small relay (`go2rtc`, `MediaMTX`, or `ffmpeg` → HLS) and set `feed_url` to the
relay's HLS/WebRTC URL instead of the raw `rtsp://`. Put the relay behind the same
auth as the rest of the app.

### Operational notes (not moralising — just what bites you)

- Accessing a device you don't own can be unlawful where the app is hosted and where
  the device is; hosting third-party private feeds can draw takedowns/abuse reports
  against the deploy IP. Gate this layer behind auth and don't expose it publicly.
- These feeds are unverified and easily spoofed/honeypotted — treat as low-confidence
  and never as targeting-grade.
- Keep discovery (Shodan/Insecam) **read-only**. Don't auto-try credentials.

---

## Quick test

```bash
curl -s 'http://localhost:3001/api/cctv?region=russia,ukraine' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.total,"cams",j.sources)})'
```
