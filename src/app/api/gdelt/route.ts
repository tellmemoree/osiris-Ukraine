import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * OSIRIS — Global Incidents API (GDELT Fallback / RSS OSINT Mapper)
 * Since GDELT v2 Geo is frequently down (404/Timeout), this fallback
 * aggregates global news RSS (BBC, Al Jazeera, etc.) and performs
 * lightweight keyword geo-mapping to generate incident points.
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

// Lightweight geo-dictionary for mapping news keywords to coordinates
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
  // Crimea
  'crimea': [34.102, 44.952], 'sevastopol': [33.522, 44.587], 'kerch': [36.470, 45.354],
  // Moldova/Belarus
  'chisinau': [28.864, 47.010], 'tiraspol': [29.643, 46.843], 'minsk': [27.561, 53.904],
};

const CONFLICT_KEYWORDS = ['attack', 'strike', 'missile', 'drone', 'war', 'troops', 'military', 'protest', 'riot', 'police', 'clash', 'bomb', 'killed', 'forces', 'mobilization', 'counterattack', 'offensive', 'ceasefire', 'shelling', 'artillery', 'occupied', 'liberated', 'incursion', 'bridgehead', 'shahed', 'himars', 'kab', 'glide bomb'];

export async function GET() {
  try {
    const allEvents: any[] = [];
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
          
          if (!titleMatch || !linkMatch) continue;
          
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
            });
          }
        }
      } catch (e) {
        console.warn(`Failed to fetch ${feed.source}`);
      }
    }

    return NextResponse.json({
      events: allEvents,
      total: allEvents.length,
      timestamp: new Date().toISOString(),
      source: 'OSINT RSS Mapping'
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error('OSINT RSS fetch error:', error);
    return NextResponse.json({ events: [], error: 'Failed to fetch OSINT data' }, { status: 500 });
  }
}
