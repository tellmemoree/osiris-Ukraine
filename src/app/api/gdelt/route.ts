import { NextResponse } from 'next/server';
import { stealthFetch } from '@/lib/stealthFetch';

export const dynamic = 'force-dynamic';

/**
 * OSIRIS — Global Incidents API (GDELT 2.0 GeoJSON, with RSS OSINT fallback)
 *
 * Primary source: GDELT GEO 2.0 API — real geo-coded events, free, no auth.
 * GDELT's geo endpoint is frequently down (404/timeout); when it returns
 * nothing usable we fall back to aggregating global + Ukraine-war news RSS
 * (BBC, Al Jazeera, ISW, Ukrainian sources, …) and lightweight keyword
 * geo-mapping so the layer is never empty.
 */

const RSS_FEEDS = [
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', source: 'BBC World' },
  { url: 'https://www.aljazeera.com/xml/rss/all.xml', source: 'Al Jazeera' },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', source: 'NYT World' },
  { url: 'https://kyivindependent.com/feed/', source: 'Kyiv Independent' },
  { url: 'https://www.ukrinform.ua/rss/block-lastnews', source: 'Ukrinform' },
  { url: 'https://www.ukrinform.ua/rss/block-war', source: 'Ukrinform War' },
  { url: 'https://www.unian.info/rss/war', source: 'UNIAN War' },
  { url: 'https://www.pravda.com.ua/eng/rss/', source: 'Ukrainska Pravda' },
  { url: 'https://euromaidanpress.com/feed/', source: 'Euromaidan Press' },
  { url: 'https://www.understandingwar.org/rss.xml', source: 'ISW' },
  { url: 'https://meduza.io/rss/all', source: 'Meduza' },
  { url: 'https://www.rferl.org/api/z_yqpiiyu-qxq', source: 'RFE/RL' },
];

// Lightweight geo-dictionary for mapping news keywords to coordinates.
// NOTE: tuples are [lng, lat] here (GeoJSON order) — the OPPOSITE of news/route.ts.
const GEO_DICT: Record<string, [number, number]> = {
  'ukraine': [31.1656, 48.3794],
  'kyiv': [30.5234, 50.4501],
  'russia': [37.6173, 55.7558],
  'moscow': [37.6173, 55.7558],
  'gaza': [34.4668, 31.5017],
  'israel': [34.8516, 31.0461],
  'tel aviv': [34.7818, 32.0853],
  'palestine': [35.2332, 31.9522],
  'iran': [53.6880, 32.4279],
  'tehran': [51.3890, 35.6892],
  'syria': [38.9968, 34.8021],
  'lebanon': [35.8623, 33.8547],
  'beirut': [35.5018, 33.8938],
  'yemen': [47.5868, 15.5527],
  'houthi': [44.2066, 15.3694], // Sana'a
  'sudan': [30.2176, 12.8628],
  'china': [116.4074, 39.9042],
  'taiwan': [120.9605, 23.6978],
  'korea': [127.7669, 35.9078],
  'usa': [-77.0369, 38.9072],
  'myanmar': [95.9560, 21.9162],
  'haiti': [-72.2852, 18.9712],
  'somalia': [46.1996, 5.1521],
  'bulgaria': [25.4858, 42.7339],
  'serbia': [21.0059, 44.0165],
  'greece': [21.8243, 39.0742],
  'turkey': [35.2433, 38.9637],
  'macedonia': [21.7453, 41.6086],
  'romania': [24.9668, 45.9432],
  'france': [2.2137, 46.2276],
  'germany': [10.4515, 51.1657],
  'uk': [-3.4359, 55.3781],
  'mexico': [-102.5528, 23.6345],
  // Frontline cities
  'bakhmut': [38.000, 48.596], 'avdiivka': [37.750, 47.967], 'toretsk': [37.820, 48.415],
  'chasiv yar': [37.859, 48.577], 'kupiansk': [37.617, 49.709], 'vovchansk': [36.940, 50.291],
  'lyman': [37.802, 48.984], 'kostiantynivka': [37.700, 48.528],
  'pokrovsk': [37.176, 48.279], 'kurakhove': [37.272, 47.988],
  'orikhiv': [35.784, 47.568], 'robotyne': [35.843, 47.455],
  // Occupied/strategic
  'mariupol': [37.549, 47.097], 'melitopol': [35.363, 46.847],
  'berdyansk': [36.790, 46.756], 'energodar': [34.655, 47.500],
  'kramatorsk': [37.556, 48.731], 'sloviansk': [37.616, 48.865],
  'kherson': [32.601, 46.635], 'zaporizhzhia': [35.139, 47.838],
  'sumy': [34.800, 50.910], 'mykolaiv': [31.994, 46.975],
  'odesa': [30.723, 46.482], 'dnipro': [35.046, 48.465],
  'kharkiv': [36.230, 49.990], 'poltava': [34.551, 49.588],
  // Russian border
  'belgorod': [36.587, 50.595], 'kursk': [36.193, 51.730],
  'bryansk': [34.364, 53.243], 'voronezh': [39.184, 51.672],
  // Russian interior cities + military airfields (frequent strike targets)
  'rostov': [39.702, 47.236], 'krasnodar': [38.975, 45.035], 'novorossiysk': [37.768, 44.724],
  'taganrog': [38.897, 47.236], 'volgograd': [44.513, 48.708], 'saratov': [46.034, 51.533],
  'engels': [46.209, 51.484], 'morozovsk': [41.791, 48.315], 'millerovo': [40.396, 48.922],
  'yeysk': [38.277, 46.710], 'ryazan': [39.692, 54.627], 'tula': [37.617, 54.193],
  'smolensk': [32.040, 54.782], 'lipetsk': [39.571, 52.603], 'murmansk': [33.083, 68.958],
  'kazan': [49.109, 55.796], 'samara': [50.100, 53.196], 'saint petersburg': [30.361, 59.931],
  'dzhankoi': [34.393, 45.709], 'saky': [33.599, 45.134],
  // Crimea
  'crimea': [34.102, 44.952], 'sevastopol': [33.522, 44.587], 'kerch': [36.470, 45.354],
  // Moldova/Belarus
  'chisinau': [28.864, 47.010], 'tiraspol': [29.643, 46.843], 'minsk': [27.561, 53.904],
};

const CONFLICT_KEYWORDS = ['attack', 'strike', 'missile', 'drone', 'war', 'troops', 'military', 'protest', 'riot', 'police', 'clash', 'bomb', 'killed', 'forces', 'mobilization', 'counterattack', 'offensive', 'ceasefire', 'shelling', 'artillery', 'occupied', 'liberated', 'incursion', 'bridgehead', 'shahed', 'himars', 'kab', 'glide bomb'];

// A geo-mapped conflict event emitted to the map layer.
interface ConflictEvent {
  id: string;
  lat: number;
  lng: number;
  name: string;
  url: string;
  html: string;
  type: string;
  published?: string;
  count?: number;
  shareimage?: string;
}

// Primary source: live GDELT GEO 2.0 API — real events with actual coordinates.
async function fetchGdeltEvents(): Promise<ConflictEvent[]> {
  const queries = [
    'protest OR riot OR unrest',
    'conflict OR military OR attack OR strike',
    'coup OR revolution OR emergency',
  ];

  const allEvents: ConflictEvent[] = [];
  let eventId = 0;

  for (const query of queries) {
    try {
      const encodedQuery = encodeURIComponent(query);
      const url = `https://api.gdeltproject.org/api/v2/geo/geo?query=${encodedQuery}&format=GeoJSON&timespan=24h&maxpoints=100`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      let geojson: any;
      try {
        const res = await stealthFetch(url, { signal: controller.signal, cache: 'no-store' });
        clearTimeout(timeoutId);
        if (!res.ok) continue;
        geojson = await res.json();
      } catch {
        clearTimeout(timeoutId);
        continue;
      }
      if (!geojson?.features) continue;

      for (const feature of geojson.features) {
        const coords = feature.geometry?.coordinates;
        if (!coords || coords.length < 2) continue;

        const props = feature.properties || {};
        const name = props.name || props.html?.replace(/<[^>]*>/g, '').slice(0, 120) || 'GDELT Event';
        const eventUrl = props.url || props.shareimage || '';

        // Deduplicate by proximity (within 0.5 degrees)
        const isDupe = allEvents.some(e =>
          Math.abs(e.lat - coords[1]) < 0.5 && Math.abs(e.lng - coords[0]) < 0.5 && e.name === name
        );
        if (isDupe) continue;

        allEvents.push({
          id: `gdelt-${eventId++}`,
          lat: coords[1],
          lng: coords[0],
          name,
          url: eventUrl,
          html: props.html || '',
          type: query.includes('protest') ? 'unrest' : query.includes('conflict') ? 'conflict' : 'political',
          count: props.count || 1,
          shareimage: props.shareimage || '',
        });
      }
    } catch {
      // Individual query failure is non-fatal
    }
  }

  return allEvents;
}

// Fallback source: aggregate global news RSS and keyword geo-map to incident points.
async function fetchRssEvents(): Promise<ConflictEvent[]> {
  const allEvents: ConflictEvent[] = [];
  let eventId = 0;

  for (const feed of RSS_FEEDS) {
    try {
      const res = await fetch(feed.url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const xml = await res.text();

      // Very rudimentary regex to extract items to avoid heavy XML parser deps
      const items = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];

      for (const item of items) {
        const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i) || item.match(/<title>(.*?)<\/title>/i);
        const linkMatch = item.match(/<link>(.*?)<\/link>/i);
        const descMatch = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/i) || item.match(/<description>(.*?)<\/description>/i);
        const dateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/i);

        if (!titleMatch || !linkMatch) continue;

        // Time of origin: RSS pubDate (fallback to now if missing/invalid).
        // Skip events older than 24h so the map self-clears.
        const parsed = dateMatch ? new Date(dateMatch[1]) : new Date();
        const published = Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
        const ageHours = (Date.now() - new Date(published).getTime()) / 3600000;
        if (ageHours > 24) continue;

        const title = titleMatch[1];
        const link = linkMatch[1];
        const desc = descMatch ? descMatch[1] : '';

        const textToSearch = (title + ' ' + desc).toLowerCase();

        // Check if it's a conflict event
        const isConflict = CONFLICT_KEYWORDS.some(kw => textToSearch.includes(kw));
        if (!isConflict) continue;

        // Try to geo-map
        let coords: [number, number] | null = null;
        for (const [location, point] of Object.entries(GEO_DICT)) {
          // using word boundary regex
          const regex = new RegExp(`\\b${location}\\b`, 'i');
          if (regex.test(textToSearch)) {
            // Deterministic jitter based on event index so events in the same country don't overlap
            const jitterLng = ((eventId * 137.5) % 200 - 100) / 100 * 1.5;
            const jitterLat = ((eventId * 251.3) % 200 - 100) / 100 * 1.5;
            coords = [point[0] + jitterLng, point[1] + jitterLat];
            break;
          }
        }

        if (coords) {
          allEvents.push({
            id: `osint-${feed.source.replace(/\s+/g, '')}-${eventId++}`,
            lat: coords[1],
            lng: coords[0],
            name: `[${feed.source}] ${title}`,
            url: link,
            html: `<a href="${link}" target="_blank">${title}</a><br/><i>Source: ${feed.source}</i>`,
            type: 'conflict',
            published,
          });
        }
      }
    } catch {
      console.warn(`Failed to fetch ${feed.source}`);
    }
  }

  return allEvents;
}

export async function GET() {
  try {
    // Try live GDELT first; fall back to RSS OSINT mapping when it's empty/down.
    let events = await fetchGdeltEvents();
    let source = 'GDELT 2.0 GeoJSON API';

    if (events.length === 0) {
      events = await fetchRssEvents();
      source = 'OSINT RSS Mapping (GDELT fallback)';
    }

    return NextResponse.json({
      events,
      total: events.length,
      timestamp: new Date().toISOString(),
      source,
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (error) {
    console.error('[OSIRIS] GDELT/OSINT fetch error:', error);
    return NextResponse.json({ events: [], total: 0, error: 'Failed to fetch incident data' }, { status: 500 });
  }
}
