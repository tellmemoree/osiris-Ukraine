import { NextResponse } from 'next/server';
import crypto from 'crypto';

/**
 * OSIRIS — Military-Grade Intelligence API
 * Fetches Telegram OSINT feeds directly, with a failsafe fallback 
 * to traditional intelligence sources if Telegram blocks the IP.
 */

const TELEGRAM_CHANNELS = [
  'OSINTtechnical', 'Faytuks', 'Liveuamap', 'CyberKnow',
  'GeneralStaffUA', 'ukraine_now', 'ua_forces',
  'UA_Insider', 'wartranslated', 'DefMonitor', 'UkraineWarReport',
  'Militaryland', 'DeepStateUA',
  'rybar',
];

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
};

function scoreRisk(text: string): number {
  const lower = text.toLowerCase();
  let score = 1;
  for (const kw of RISK_KEYWORDS) {
    if (lower.includes(kw)) score += 2;
  }
  return Math.min(10, score);
}

function findCoords(text: string): [number, number] | null {
  const lower = text.toLowerCase();
  for (const [keyword, coords] of Object.entries(KEYWORD_COORDS)) {
    if (lower.includes(keyword)) return coords;
  }
  return null;
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

    const text = textMatch[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
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

    const title = getTag('title').replace(/<[^>]+>/g, '');
    const desc = getTag('description').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"');
    
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

    const newsItems = allArticles.map(article => {
      const riskScore = scoreRisk(article.description || article.title);
      const coords = findCoords(article.description || article.title);

      return {
        id: crypto.createHash('md5').update((article.link || '') + (article.pubDate || '')).digest('hex'),
        title: article.title,
        description: article.description,
        link: article.link,
        published: article.pubDate,
        source: article.source,
        risk_score: riskScore,
        coords: coords ? [coords[0], coords[1]] : null,
        coords_default: !coords,
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
