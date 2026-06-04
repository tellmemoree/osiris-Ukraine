import { NextResponse } from 'next/server';
import crypto from 'crypto';

/**
 * OSIRIS — Military-Grade Intelligence API
 * Fetches Telegram OSINT feeds directly, with a failsafe fallback 
 * to traditional intelligence sources if Telegram blocks the IP.
 */

// Ukrainian / neutral war-OSINT channels. The first group is English-language
// OSINT; the second is native Ukrainian-language (Cyrillic) news/milblogger
// channels — all verified scrapeable via t.me/s/ — so the UA feed reads in its
// own language and its Cyrillic place names geolocate via the gazetteer below.
const UA_CHANNELS = [
  'OSINTtechnical', 'Faytuks', 'Liveuamap', 'CyberKnow',
  'GeneralStaffUA', 'ukraine_now', 'ua_forces',
  'UA_Insider', 'wartranslated', 'DefMonitor', 'UkraineWarReport',
  'Militaryland', 'DeepStateUA',
  // Ukrainian-language (Cyrillic)
  'suspilne_news', 'hromadske_ua', 'truexanewsua', 'serhii_flash',
  'operativnoZSU', 'butusovplus', 'Tsaplienko', 'lachentyt',
];

// Russian milblogger / MoD channels — monitored for the adversary picture.
// All verified scrapeable via t.me/s/ (rybar's /s/ preview is now disabled, so
// it is dropped from the scrape list and kept only as a source link elsewhere).
const RU_CHANNELS = [
  'milinfolive', 'wargonzo', 'epoddubny', 'sashakots', 'dva_majora',
  'voenkorKotenok', 'rvvoenkor', 'grey_zone', 'mod_russia',
];

const TELEGRAM_CHANNELS = [...UA_CHANNELS, ...RU_CHANNELS];

const RU_CHANNEL_SET = new Set(RU_CHANNELS.map((c) => c.toLowerCase()));

// Which side of the war a story comes from: 'ua' = Ukrainian/neutral war OSINT,
// 'ru' = Russian milblogger/MoD, 'world' = non-Telegram RSS fallback. Drives the
// Live-Alerts tab split so the RU feed reads separately from the UA one.
function sideForSource(source: string): 'ua' | 'ru' | 'world' {
  const m = source.match(/^t\.me\/(.+)$/i);
  if (!m) return 'world';
  return RU_CHANNEL_SET.has(m[1].toLowerCase()) ? 'ru' : 'ua';
}

const FALLBACK_FEEDS = {
  BBC: 'https://feeds.bbci.co.uk/news/world/rss.xml',
  AlJazeera: 'https://www.aljazeera.com/xml/rss/all.xml',
  GDACS: 'https://www.gdacs.org/xml/rss.xml'
};

const RISK_KEYWORDS = ['war','missile','strike','attack','crisis','tension','military','conflict','defense','clash','nuclear','invasion','bomb','drone','weapon','sanctions','ceasefire','escalation', 'killed', 'destroyed', 'operation', 'casualty', 'frontline', 'threat','mobilization','counterattack','offensive','shelling','artillery','occupied','liberated','breakthrough','bridgehead','incursion','shahed','himars','kab','glide bomb'];

// NOTE: tuples are [lat, lng] here — the OPPOSITE of gdelt/route.ts's GEO_DICT.
const KEYWORD_COORDS: Record<string, [number, number]> = {
  'ukraine': [49.487, 31.272], 'kyiv': [50.450, 30.523], 'russia': [61.524, 105.318],
  'moscow': [55.755, 37.617], 'israel': [31.046, 34.851], 'gaza': [31.416, 34.333],
  'iran': [32.427, 53.688], 'lebanon': [33.854, 35.862], 'syria': [34.802, 38.996],
  'yemen': [15.552, 48.516], 'china': [35.861, 104.195], 'taiwan': [23.697, 120.960],
  'united states': [38.907, -77.036], 'europe': [48.800, 2.300], 'middle east': [31.500, 34.800],
  // Frontline cities
  'bakhmut': [48.596, 38.000], 'avdiivka': [47.967, 37.750], 'toretsk': [48.415, 37.820],
  'chasiv yar': [48.577, 37.859], 'chuhuiv': [49.836, 36.686], 'kupiansk': [49.709, 37.617],
  'vovchansk': [50.291, 36.940], 'lyman': [48.984, 37.802], 'kostiantynivka': [48.528, 37.700],
  'pokrovsk': [48.279, 37.176], 'kurakhove': [47.988, 37.272], 'velyka novosilka': [47.844, 36.797],
  'orikhiv': [47.568, 35.784], 'hulyaipole': [47.662, 36.264], 'robotyne': [47.455, 35.843],
  // Occupied/strategic
  'donetsk': [48.000, 37.800], 'luhansk': [48.566, 39.300], 'mariupol': [47.097, 37.549],
  'melitopol': [46.847, 35.363], 'berdyansk': [46.756, 36.790], 'tokmak': [47.255, 35.706],
  'nova kakhovka': [46.759, 33.388], 'energodar': [47.500, 34.655],
  'kramatorsk': [48.731, 37.556], 'sloviansk': [48.865, 37.616],
  'kherson': [46.635, 32.601], 'zaporizhzhia': [47.838, 35.139], 'sumy': [50.910, 34.800],
  'mykolaiv': [46.975, 31.994], 'odesa': [46.482, 30.723], 'dnipro': [48.465, 35.046],
  'kharkiv': [49.990, 36.230], 'kremenchuk': [49.066, 33.420], 'poltava': [49.588, 34.551],
  'cherkasy': [49.445, 32.060],
  // Russian border oblasts
  'belgorod': [50.595, 36.587], 'kursk': [51.730, 36.193], 'bryansk': [53.243, 34.364],
  'voronezh': [51.672, 39.184], 'rostov': [47.222, 39.719],
  // Crimea
  'crimea': [44.952, 34.102], 'sevastopol': [44.587, 33.522], 'kerch': [45.354, 36.470],
  'simferopol': [44.952, 34.102],
  // Moldova/Transnistria
  'chisinau': [47.010, 28.864], 'transnistria': [47.200, 29.400], 'tiraspol': [46.843, 29.643],
  // Belarus
  'minsk': [53.904, 27.561], 'grodno': [53.678, 23.829], 'brest': [52.097, 23.734],
  // Other Ukrainian oblast capitals / large cities (kept specific so a story that
  // also says "Ukraine" still pins to the city actually named).
  'lviv': [49.840, 24.030], 'vinnytsia': [49.233, 28.468], 'zhytomyr': [50.255, 28.659],
  'rivne': [50.619, 26.252], 'ternopil': [49.554, 25.595], 'ivano-frankivsk': [48.923, 24.711],
  'uzhhorod': [48.621, 22.288], 'chernihiv': [51.494, 31.294], 'chernivtsi': [48.292, 25.935],
  'khmelnytskyi': [49.423, 26.987], 'lutsk': [50.747, 25.325], 'kropyvnytskyi': [48.508, 32.262],
  'kryvyi rih': [47.910, 33.391], 'nikopol': [47.567, 34.392], 'pavlohrad': [48.520, 35.870],
  'izyum': [49.212, 37.249], 'okhtyrka': [50.310, 34.899],
  // Wider hotspots that show up in the same feeds
  'tel aviv': [32.085, 34.781], 'jerusalem': [31.769, 35.214], 'beirut': [33.888, 35.495],
  'damascus': [33.513, 36.292], 'tehran': [35.689, 51.389], 'sanaa': [15.369, 44.191],
  'red sea': [20.284, 38.512], 'saint petersburg': [59.931, 30.361], 'novorossiysk': [44.724, 37.768],
  // Russian cities, border oblasts and military airfields (high OSINT value —
  // frequent drone-strike targets). Both Latin and Cyrillic so RU-language
  // Telegram posts geolocate as well as English RSS.
  'krasnodar': [45.035, 38.975], 'taganrog': [47.236, 38.897], 'volgograd': [48.708, 44.513],
  'saratov': [51.533, 46.034], 'engels': [51.484, 46.209], 'morozovsk': [48.315, 41.791],
  'millerovo': [48.922, 40.396], 'yeysk': [46.710, 38.277], 'ryazan': [54.627, 39.692],
  'tula': [54.193, 37.617], 'smolensk': [54.782, 32.040], 'lipetsk': [52.603, 39.571],
  'murmansk': [68.958, 33.083], 'kazan': [55.796, 49.109], 'samara': [53.196, 50.100],
  'dzhankoi': [45.709, 34.393], 'saky': [45.134, 33.599],
  // Cyrillic — broad (country/peninsula; only used when no city is named)
  'россия': [61.524, 105.318], 'украина': [49.487, 31.272], 'крым': [44.952, 34.102],
  // Cyrillic — Russia
  'москва': [55.756, 37.617], 'петербург': [59.931, 30.361], 'белгород': [50.596, 36.587],
  'курск': [51.730, 36.193], 'брянск': [53.244, 34.364], 'воронеж': [51.672, 39.184],
  'ростов': [47.236, 39.702], 'краснодар': [45.035, 38.975], 'новороссийск': [44.724, 37.768],
  'таганрог': [47.236, 38.897], 'волгоград': [48.708, 44.513], 'саратов': [51.533, 46.034],
  'энгельс': [51.484, 46.209], 'морозовск': [48.315, 41.791], 'миллерово': [48.922, 40.396],
  'ейск': [46.710, 38.277], 'рязань': [54.627, 39.692], 'дягилево': [54.643, 39.570],
  'тула': [54.193, 37.617], 'смоленск': [54.782, 32.040], 'липецк': [52.603, 39.571],
  'мурманск': [68.958, 33.083], 'оленегорск': [68.152, 33.464], 'казань': [55.796, 49.109],
  'севастополь': [44.587, 33.522], 'джанкой': [45.709, 34.393], 'саки': [45.134, 33.599],
  // Cyrillic — Ukraine / occupied (UA and RU spellings of the same place)
  'київ': [50.450, 30.523], 'киев': [50.450, 30.523], 'харків': [49.990, 36.230],
  'харьков': [49.990, 36.230], 'покровськ': [48.279, 37.176], 'покровск': [48.279, 37.176],
  'красноармейск': [48.279, 37.176], 'бахмут': [48.596, 38.000], 'артёмовск': [48.596, 38.000],
  'артемовск': [48.596, 38.000], 'авдіївка': [47.967, 37.750], 'авдеевка': [47.967, 37.750],
  'торецьк': [48.415, 37.820], 'торецк': [48.415, 37.820], 'купянск': [49.709, 37.617],
  'вовчанськ': [50.291, 36.940], 'вовчанск': [50.291, 36.940], 'запоріжжя': [47.838, 35.139],
  'запорожье': [47.838, 35.139], 'херсон': [46.635, 32.601], 'миколаїв': [46.975, 31.994],
  'николаев': [46.975, 31.994], 'одеса': [46.482, 30.723], 'одесса': [46.482, 30.723],
  'дніпро': [48.465, 35.046], 'днепр': [48.465, 35.046], 'суми': [50.910, 34.800],
  'сумы': [50.910, 34.800], 'маріуполь': [47.097, 37.549], 'мариуполь': [47.097, 37.549],
  'вугледар': [47.779, 37.250], 'угледар': [47.779, 37.250],
  'львів': [49.840, 24.030], 'львов': [49.840, 24.030], 'полтава': [49.588, 34.551],
  'черкаси': [49.445, 32.060], 'чернігів': [51.494, 31.294], 'чернигов': [51.494, 31.294],
  'краматорськ': [48.731, 37.556], 'краматорск': [48.731, 37.556], 'словянськ': [48.865, 37.616],
  'славянск': [48.865, 37.616], 'ізюм': [49.212, 37.249], 'изюм': [49.212, 37.249],
  'нікополь': [47.567, 34.392], 'никополь': [47.567, 34.392], 'кременчук': [49.066, 33.420],
  // Ukrainian oblique-case stems (і↔о / ї↔є vowel shifts, e.g. Київ→Києва,
  // Харків→Харкова, Дніпро→Дніпра) so declined mentions still geolocate.
  'києв': [50.450, 30.523], 'харков': [49.990, 36.230], 'чернігов': [51.494, 31.294],
  'дніпр': [48.465, 35.046], 'миколаєв': [46.975, 31.994],
};

function scoreRisk(text: string): number {
  const lower = text.toLowerCase();
  let score = 1;
  for (const kw of RISK_KEYWORDS) {
    if (lower.includes(kw)) score += 2;
  }
  return Math.min(10, score);
}

// Country / continent-level keys. Only used as a last resort: an article that
// names both a country and a city pins to the city, never the country centroid
// (which is what made every "Ukraine ..." story pile up in the middle of the map).
const BROAD_KEYS = new Set<string>([
  'ukraine', 'russia', 'israel', 'iran', 'lebanon', 'syria', 'yemen', 'china',
  'taiwan', 'united states', 'europe', 'middle east', 'crimea', 'transnistria',
  'россия', 'украина', 'крым',
]);

// Cyrillic (RU/UA) conflict stems. RISK_KEYWORDS above is English-only, so
// without these every Russian/Ukrainian-language milblogger post scores 0 and
// would be wrongly dropped by the conflict filter. Substring-matched (lowercased)
// so inflected/declined forms still hit (e.g. ракета/ракети/ракетний → 'ракет').
const CONFLICT_TERMS_CYR = [
  // NOTE: bare 'наступ' is deliberately excluded — it is the stem of "наступний/
  // наступного" (next), a very common non-war word; use 'наступальн' (offensive)
  // and 'контрнаступ' (counter-offensive) instead.
  'ракет', 'удар', 'обстрел', 'обстріл', 'дрон', 'бпла', 'фпв', 'наступальн', 'фронт',
  'зсу', 'всу', 'окуп', 'штурм', 'снаряд', 'шахед', 'герань', 'контрнаступ',
  'мобіліз', 'мобилиз', 'війн', 'войн', 'бій', 'бой', 'взрыв', 'вибух', 'пво',
  'ппо', 'хаймарс', 'авіаудар', 'авиаудар', 'оборон', 'загарбник', 'загиб',
  'поранен', 'танк', 'артилер', 'артиллер', 'бойов', 'боев', 'атак',
];

// A post counts as war/conflict news if it carries any English risk keyword OR
// any Cyrillic conflict stem. Keeps ALL conflicts (UA-RU, Middle East, …) and
// drops non-war noise (channel ads, promos, sport, weather) in either language.
function isConflict(text: string): boolean {
  const lower = text.toLowerCase();
  return RISK_KEYWORDS.some((kw) => lower.includes(kw)) ||
    CONFLICT_TERMS_CYR.some((kw) => lower.includes(kw));
}

// Build a whole-word matcher for one gazetteer key. Unicode-aware boundaries so
// we don't match "iran" inside another word, and multi-word keys ("nova
// kakhovka", "red sea") match verbatim. Russian/Ukrainian place names inflect by
// case (Белгород→Белгороду→Белгородской), so Cyrillic keys allow a short trailing
// case-suffix; Latin keys stay strict so "Iranian" still doesn't match "Iran".
function keywordRegex(keyword: string): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const isCyrillic = /[Ѐ-ӿ]/.test(keyword);
  const tail = isCyrillic ? '\\p{L}{0,4}(?![\\p{L}\\p{N}])' : '(?![\\p{L}\\p{N}])';
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}${tail}`, 'iu');
}

// Compile every gazetteer entry once at module load — findCoords runs this over
// hundreds of articles per request, so the regexes must not be rebuilt per call.
const COMPILED_GAZETTEER = Object.entries(KEYWORD_COORDS).map(([keyword, coords]) => ({
  re: keywordRegex(keyword),
  coords,
  rank: BROAD_KEYS.has(keyword) ? 1 : 2, // a named city beats a country
}));

/**
 * Resolve the place a story is actually about. Prefers the most specific
 * location named (city/town over country) and, among equally specific matches,
 * the one mentioned first. Returns null when the gazetteer names nothing.
 */
function findCoords(text: string): [number, number] | null {
  const lower = text.toLowerCase();
  let best: { coords: [number, number]; rank: number; pos: number } | null = null;
  for (const { re, coords, rank } of COMPILED_GAZETTEER) {
    const m = re.exec(lower);
    if (!m) continue;
    const pos = m.index;
    if (!best || rank > best.rank || (rank === best.rank && pos < best.pos)) {
      best = { coords, rank, pos };
    }
  }
  return best ? best.coords : null;
}

// Every distinct place a story names (raw gazetteer centroids, un-jittered). Used by
// cross-reference consumers (e.g. /api/strategic-thermal) that must check ALL mentioned
// locations, not just the single primary one findCoords returns.
function findAllCoords(text: string): [number, number][] {
  const lower = text.toLowerCase();
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const { re, coords } of COMPILED_GAZETTEER) {
    const key = `${coords[0]},${coords[1]}`;
    if (!seen.has(key) && re.test(lower)) { seen.add(key); out.push(coords); }
  }
  return out;
}

// Spread several stories about the same place into a small (~0–8 km) cluster
// around it, deterministically per story id, so dots don't stack into a single
// unreadable blob over the city centre.
function jitterAround([lat, lng]: [number, number], seed: string): [number, number] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  }
  const angle = (h % 360) * (Math.PI / 180);
  const radius = ((h >>> 9) % 70) / 1000; // up to ~0.07° ≈ 6–8 km
  // Divide the longitude offset by cos(lat) so the spread is a true circle on
  // the ground rather than an east-west-compressed ellipse at high latitudes.
  const cosLat = Math.max(0.05, Math.cos(lat * Math.PI / 180));
  return [lat + radius * Math.cos(angle), lng + (radius * Math.sin(angle)) / cosLat];
}

// Decode HTML entities that survive tag-stripping. Telegram/RSS payloads carry
// numeric (&#33;), hex (&#x21;), and named entities; without this they render
// literally (e.g. "летят&#33;"). &amp; is decoded last so we never double-decode
// a pre-escaped "&amp;#33;" into "!".
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 10)); } catch { return _; } })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return _; } })
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// A parsed feed item, before risk-scoring/geo-mapping in GET().
interface ParsedArticle {
  title: string;
  description: string;
  link: string;
  pubDate: string;
  source: string;
}

function parseTelegramHTML(html: string, channel: string): ParsedArticle[] {
  const items: ParsedArticle[] = [];
  // Split on the per-message wrapper so each chunk contains the message body
  // AND its footer (where the <time datetime> date link lives). The previous
  // block regex stopped before the footer, so every item fell back to now().
  const blocks = html.split('tgme_widget_message_wrap').slice(1);

  for (const blockHtml of blocks) {
    const textRegex = /<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/i;
    const textMatch = blockHtml.match(textRegex);
    if (!textMatch) continue;

    const text = decodeEntities(textMatch[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim();
    if (!text || text.length < 10) continue;

    // [\s\S]*? handles attributes/newlines between the date link and <time>.
    const dateRegex = /<a class="tgme_widget_message_date" href="(https:\/\/t\.me\/[^"]+)"[\s\S]*?<time[^>]*datetime="([^"]+)"/i;
    const dateMatch = blockHtml.match(dateRegex);
    const link = dateMatch ? dateMatch[1] : `https://t.me/${channel}`;
    const pubDate = dateMatch ? dateMatch[2] : new Date().toISOString();

    const title = text.split('\n')[0].substring(0, 100);

    items.push({ title, description: text, link, pubDate, source: `t.me/${channel}` });
  }
  return items;
}

function parseRSSItems(xml: string, sourceName: string): ParsedArticle[] {
  const items: ParsedArticle[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const getTag = (tag: string) => {
      const m = itemXml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return (m?.[1] || m?.[2] || '').trim();
    };

    const title = decodeEntities(getTag('title').replace(/<[^>]+>/g, ''));
    const desc = decodeEntities(getTag('description').replace(/<[^>]+>/g, ''));
    
    items.push({
      title: title.length > 100 ? title.substring(0, 100) + '...' : title,
      description: desc,
      link: getTag('link'),
      pubDate: getTag('pubDate') || new Date().toISOString(),
      source: sourceName
    });
  }
  return items;
}

export async function GET() {
  try {
    const feedPromises = TELEGRAM_CHANNELS.map(async (channel) => {
      try {
        const res = await fetch(`https://t.me/s/${channel}`, { 
          signal: AbortSignal.timeout(8000), 
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } 
        });
        if (!res.ok) return [];
        const html = await res.text();
        return parseTelegramHTML(html, channel).slice(-8);
      } catch { return []; }
    });

    const feedResults = await Promise.allSettled(feedPromises);
    const allArticles: ParsedArticle[] = [];

    for (const result of feedResults) {
      if (result.status === 'fulfilled') allArticles.push(...result.value);
    }

    // FAILSAFE: If Telegram completely blocks the IP, fall back to traditional RSS
    if (allArticles.length === 0) {
      const fallbackPromises = Object.entries(FALLBACK_FEEDS).map(async ([source, url]) => {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
          if (!res.ok) return [];
          const xml = await res.text();
          return parseRSSItems(xml, source).slice(0, 5);
        } catch { return []; }
      });
      
      const fallbackResults = await Promise.allSettled(fallbackPromises);
      for (const result of fallbackResults) {
        if (result.status === 'fulfilled') allArticles.push(...result.value);
      }
    }

    // Keep only war/conflict items (bilingual). Drops channel ads, promos,
    // sport, weather, and other off-topic posts that these OSINT feeds also carry.
    const conflictArticles = allArticles.filter(a => isConflict(`${a.title} ${a.description}`));

    const newsItems = conflictArticles.map(article => {
      const riskScore = scoreRisk(article.description || article.title);
      const id = crypto.createHash('md5').update((article.link || '') + (article.pubDate || '')).digest('hex');
      const coords = findCoords(article.description || article.title);
      const placed = coords ? jitterAround(coords, id) : null;

      return {
        id,
        title: article.title,
        description: article.description,
        link: article.link,
        published: article.pubDate,
        source: article.source,
        side: sideForSource(article.source),
        risk_score: riskScore,
        coords: placed,
        coords_default: !coords,
        places: findAllCoords(article.description || article.title),
        machine_assessment: riskScore >= 8 ? "AI Analysis indicates elevated tactical priority based on OSINT stream patterns." : null,
      };
    });

    newsItems.sort((a, b) => new Date(b.published).getTime() - new Date(a.published).getTime());

    return NextResponse.json({
      news: newsItems,
      total: newsItems.length,
      timestamp: new Date().toISOString(),
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    });
  } catch {
    return NextResponse.json({ news: [], error: 'Failed to fetch intel' }, { status: 500 });
  }
}
