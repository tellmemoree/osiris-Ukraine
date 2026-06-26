/**
 * OSIRIS — Conflict Geo Shared Library
 *
 * Shared constants and utilities used by /api/conflict-events and
 * /api/gdelt (deprecation alias). Extracted so both routes share a single
 * source of truth for GEO_DICT, RSS_FEEDS, CONFLICT_KEYWORDS, and the
 * deduplication / confidence-tiering algorithm.
 *
 * NOTE: GEO_DICT tuples are [lng, lat] (GeoJSON order).
 */

// ── Unified event types ──────────────────────────────────────────────────────

export type Confidence = 'confirmed' | 'reported' | 'unverified';
export type EventType = 'battle' | 'strike' | 'unrest' | 'one-sided' | 'conflict' | 'political';

export interface ConflictEvent {
  id: string;
  lat: number;
  lng: number;
  name: string;
  url?: string;
  html?: string;
  eventType: EventType;
  sources: string[];
  confidence?: Confidence; // set by clusterEvents(); absent on raw pre-cluster events
  published?: string; // ISO 8601 UTC
  deaths?: number;
}

// ── RSS feeds ────────────────────────────────────────────────────────────────

export const RSS_FEEDS = [
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml',          source: 'BBC World' },
  { url: 'https://www.aljazeera.com/xml/rss/all.xml',            source: 'Al Jazeera' },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', source: 'NYT World' },
  { url: 'https://kyivindependent.com/feed/',                    source: 'Kyiv Independent' },
  { url: 'https://www.ukrinform.ua/rss/block-lastnews',          source: 'Ukrinform' },
  { url: 'https://www.ukrinform.ua/rss/block-war',               source: 'Ukrinform War' },
  { url: 'https://www.unian.info/rss/war',                       source: 'UNIAN War' },
  { url: 'https://www.pravda.com.ua/eng/rss/',                   source: 'Ukrainska Pravda' },
  { url: 'https://euromaidanpress.com/feed/',                    source: 'Euromaidan Press' },
  { url: 'https://www.understandingwar.org/rss.xml',             source: 'ISW' },
  { url: 'https://meduza.io/rss/all',                            source: 'Meduza' },
  { url: 'https://www.rferl.org/api/z_yqpiiyu-qxq',             source: 'RFE/RL' },
];

// ── Geo dictionary ───────────────────────────────────────────────────────────
// Tuples are [lng, lat] (GeoJSON order).

export const GEO_DICT: Record<string, [number, number]> = {
  'ukraine':        [31.1656, 48.3794],
  'kyiv':           [30.5234, 50.4501],
  'russia':         [37.6173, 55.7558],
  'moscow':         [37.6173, 55.7558],
  'gaza':           [34.4668, 31.5017],
  'israel':         [34.8516, 31.0461],
  'tel aviv':       [34.7818, 32.0853],
  'palestine':      [35.2332, 31.9522],
  'iran':           [53.6880, 32.4279],
  'tehran':         [51.3890, 35.6892],
  'syria':          [38.9968, 34.8021],
  'lebanon':        [35.8623, 33.8547],
  'beirut':         [35.5018, 33.8938],
  'yemen':          [47.5868, 15.5527],
  'houthi':         [44.2066, 15.3694],
  'sudan':          [30.2176, 12.8628],
  'china':          [116.4074, 39.9042],
  'taiwan':         [120.9605, 23.6978],
  'korea':          [127.7669, 35.9078],
  'usa':            [-77.0369, 38.9072],
  'myanmar':        [95.9560, 21.9162],
  'haiti':          [-72.2852, 18.9712],
  'somalia':        [46.1996, 5.1521],
  'bulgaria':       [25.4858, 42.7339],
  'serbia':         [21.0059, 44.0165],
  'greece':         [21.8243, 39.0742],
  'turkey':         [35.2433, 38.9637],
  'macedonia':      [21.7453, 41.6086],
  'romania':        [24.9668, 45.9432],
  'france':         [2.2137, 46.2276],
  'germany':        [10.4515, 51.1657],
  'uk':             [-3.4359, 55.3781],
  'mexico':         [-102.5528, 23.6345],
  // Frontline cities
  'bakhmut':        [38.000, 48.596],
  'avdiivka':       [37.750, 47.967],
  'toretsk':        [37.820, 48.415],
  'chasiv yar':     [37.859, 48.577],
  'kupiansk':       [37.617, 49.709],
  'vovchansk':      [36.940, 50.291],
  'lyman':          [37.802, 48.984],
  'kostiantynivka': [37.700, 48.528],
  'pokrovsk':       [37.176, 48.279],
  'kurakhove':      [37.272, 47.988],
  'orikhiv':        [35.784, 47.568],
  'robotyne':       [35.843, 47.455],
  // Occupied / strategic
  'mariupol':       [37.549, 47.097],
  'melitopol':      [35.363, 46.847],
  'berdyansk':      [36.790, 46.756],
  'energodar':      [34.655, 47.500],
  'kramatorsk':     [37.556, 48.731],
  'sloviansk':      [37.616, 48.865],
  'kherson':        [32.601, 46.635],
  'zaporizhzhia':   [35.139, 47.838],
  'sumy':           [34.800, 50.910],
  'mykolaiv':       [31.994, 46.975],
  'odesa':          [30.723, 46.482],
  'dnipro':         [35.046, 48.465],
  'kharkiv':        [36.230, 49.990],
  'poltava':        [34.551, 49.588],
  // Russian border
  'belgorod':       [36.587, 50.595],
  'kursk':          [36.193, 51.730],
  'bryansk':        [34.364, 53.243],
  'voronezh':       [39.184, 51.672],
  // Russian interior / military airfields
  'rostov':         [39.702, 47.236],
  'krasnodar':      [38.975, 45.035],
  'novorossiysk':   [37.768, 44.724],
  'taganrog':       [38.897, 47.236],
  'volgograd':      [44.513, 48.708],
  'saratov':        [46.034, 51.533],
  'engels':         [46.209, 51.484],
  'morozovsk':      [41.791, 48.315],
  'millerovo':      [40.396, 48.922],
  'yeysk':          [38.277, 46.710],
  'ryazan':         [39.692, 54.627],
  'tula':           [37.617, 54.193],
  'smolensk':       [32.040, 54.782],
  'lipetsk':        [39.571, 52.603],
  'murmansk':       [33.083, 68.958],
  'kazan':          [49.109, 55.796],
  'samara':         [50.100, 53.196],
  'saint petersburg': [30.361, 59.931],
  'dzhankoi':       [34.393, 45.709],
  'saky':           [33.599, 45.134],
  // Crimea
  'crimea':         [34.102, 44.952],
  'sevastopol':     [33.522, 44.587],
  'kerch':          [36.470, 45.354],
  // Moldova / Belarus
  'chisinau':       [28.864, 47.010],
  'tiraspol':       [29.643, 46.843],
  'minsk':          [27.561, 53.904],
};

// ── Conflict keywords ────────────────────────────────────────────────────────

export const CONFLICT_KEYWORDS = [
  'attack', 'strike', 'missile', 'drone', 'war', 'troops', 'military',
  'protest', 'riot', 'police', 'clash', 'bomb', 'killed', 'forces',
  'mobilization', 'counterattack', 'offensive', 'ceasefire', 'shelling',
  'artillery', 'occupied', 'liberated', 'incursion', 'bridgehead',
  'shahed', 'himars', 'kab', 'glide bomb',
];

// ── Geo mapper ───────────────────────────────────────────────────────────────

// Pre-compiled at module load — avoids rebuilding 90+ RegExps on every call.
const GEO_MATCHERS: Array<[RegExp, [number, number]]> = Object.entries(GEO_DICT).map(
  ([loc, point]) => [new RegExp(`\\b${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), point],
);

/**
 * Scans text for the first GEO_DICT keyword using word-boundary matching.
 * Returns a raw [lng, lat] tuple or null if no keyword matches.
 * Callers that need map jitter must apply it themselves.
 */
export function geoMapText(text: string): [number, number] | null {
  const lower = text.toLowerCase();
  for (const [regex, point] of GEO_MATCHERS) {
    if (regex.test(lower)) return point;
  }
  return null;
}

// ── Deduplication + confidence tiering ───────────────────────────────────────

// Source families: sources within the same family share one upstream.
// 'confirmed' requires ≥2 distinct families, not just ≥2 source labels.
const SOURCE_FAMILY: Record<string, string> = {
  'gdelt':      'gdelt',
  'gdelt-rss':  'gdelt',   // same upstream as gdelt geo — not independent
  'telegram':   'telegram',
  'ucdp':       'ucdp',
  'reliefweb':  'reliefweb',
};

function bucketId(key: string): string {
  // btoa is Web-standard and edge-safe; avoids Node-only Buffer.
  return btoa(key).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' }[c] ?? c)).slice(0, 12);
}

/**
 * Clusters raw ConflictEvents by 0.3° spatial + 2-hour temporal bucket.
 * Single-pass merge per cluster; confidence is based on distinct source
 * *families* so gdelt + gdelt-rss (both GDELT-derived) count as one family.
 *
 * Confidence tiers:
 *   confirmed   — ≥ 2 distinct source families present
 *   unverified  — sole family is 'telegram'
 *   reported    — everything else
 */
export function clusterEvents(raw: ConflictEvent[]): ConflictEvent[] {
  const buckets = new Map<string, ConflictEvent[]>();

  for (const ev of raw) {
    const ts = ev.published ? new Date(ev.published).getTime() : Date.now();
    const timeBucket = Number.isNaN(ts) ? Math.floor(Date.now() / 7_200_000) : Math.floor(ts / 7_200_000);
    const key = `${Math.round(ev.lat / 0.3)}|${Math.round(ev.lng / 0.3)}|${timeBucket}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(ev);
    buckets.set(key, bucket);
  }

  const merged: ConflictEvent[] = [];

  for (const [key, cluster] of buckets) {
    // Single pass: accumulate everything needed for the merged event.
    let latSum = 0, lngSum = 0, totalDeaths = 0;
    let longestName = '';
    let earliestTs = Infinity;
    let firstUrl: string | undefined;
    let firstHtml: string | undefined;
    const firstEventType = cluster[0].eventType;
    const familySet = new Set<string>();
    const sourceSet = new Set<string>();

    for (const e of cluster) {
      latSum += e.lat;
      lngSum += e.lng;
      totalDeaths += e.deaths ?? 0;
      if (e.name.length > longestName.length) longestName = e.name;
      if (e.published) {
        const t = new Date(e.published).getTime();
        if (!Number.isNaN(t) && t < earliestTs) earliestTs = t;
      }
      if (!firstUrl && e.url) firstUrl = e.url;
      if (!firstHtml && e.html) firstHtml = e.html;
      for (const s of e.sources) {
        sourceSet.add(s);
        familySet.add(SOURCE_FAMILY[s] ?? s);
      }
    }

    const allSources = Array.from(sourceSet);
    const earliestPublished = isFinite(earliestTs) ? new Date(earliestTs).toISOString() : undefined;

    let confidence: Confidence;
    if (familySet.size >= 2) {
      confidence = 'confirmed';
    } else if (familySet.size === 1 && familySet.has('telegram')) {
      confidence = 'unverified';
    } else {
      confidence = 'reported';
    }

    merged.push({
      id: bucketId(key),
      lat: latSum / cluster.length,
      lng: lngSum / cluster.length,
      name: longestName || 'Conflict event',
      url: firstUrl,
      html: firstHtml,
      eventType: firstEventType,
      sources: allSources,
      confidence,
      published: earliestPublished,
      deaths: totalDeaths > 0 ? totalDeaths : undefined,
    });
  }

  return merged;
}
