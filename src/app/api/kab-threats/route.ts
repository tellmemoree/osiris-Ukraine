import { NextResponse } from 'next/server';
import { stealthFetch } from '@/lib/stealthFetch';

export const dynamic = 'force-dynamic';

/**
 * OSIRIS — KAB / Glide-Bomb Threat Signal (Telegram-derived)
 *
 * There is no structured, keyless feed for guided glide-bomb (KAB / UMPK) threats:
 * the binary air-raid feed (vadimklimenko) carries no threat type, and alerts.in.ua
 * has no KAB category. KAB warnings circulate as free text in Ukrainian OSINT
 * Telegram channels. This route scrapes those channels, regex-detects KAB mentions
 * (UK / RU / EN, with Unicode-aware word boundaries), attributes each to an oblast by
 * keyword, keeps only the recent window, and aggregates one threat marker per oblast.
 *
 * This is an explicitly heuristic, text-derived signal — not a structured alert.
 * It replaces the ADS-B `bomb_risk` flag as the primary KAB indicator, because the
 * aircraft launching glide bombs fly with transponders off and never appear on ADS-B.
 */

// UA-focused channels that routinely report inbound KAB/UMPK launches.
const UA_THREAT_CHANNELS = [
  'GeneralStaffUA', 'DeepStateUA', 'Militaryland', 'UkraineWarReport',
  'ukraine_now', 'ua_forces', 'kpszsu', 'war_monitor',
];

// KAB / guided-glide-bomb mentions across UK / RU / EN. The \p{L} look-arounds give
// Unicode-aware word boundaries so we don't match inside words like "кабінет",
// "кабель" or "Kabul". Requires the /u flag (present on each pattern).
const KAB_PATTERNS: RegExp[] = [
  /(?<!\p{L})каб(?:и|ів|ами|ах|у)?(?!\p{L})/iu, // КАБ + UK/RU declensions
  /(?<!\p{L})kab(?:s)?(?!\p{L})/iu,             // English "KAB"
  /(?<!\p{L})умп[кб](?!\p{L})/iu,               // УМПК / УМПБ glide-kit
  /керован\p{L}*\s+аві?абомб/iu,                // керована авіабомба / RU авиабомба
  /планир\p{L}*\s+бомб/iu,                      // RU "планирующая бомба"
  /glide[-\s]*bomb|guided\s+(?:aerial\s+)?bomb/i,
];

// Oblast attribution. coords are [lng, lat] (GeoJSON order), matching the existing
// air-raid layer. Tokens are lowercase stems covering UK declensions + key cities,
// so "Харківщину" / "Куп'янськ" / "Kharkiv" all resolve to the same oblast.
interface OblastRef {
  oblast: string;
  coords: [number, number];
  tokens: string[];
}
const OBLAST_REFS: OblastRef[] = [
  { oblast: 'Kharkiv oblast', coords: [36.230, 49.990], tokens: ['харків', 'харківщ', 'kharkiv', 'чугуїв', "куп'янськ", 'kupiansk', 'вовчанськ', 'vovchansk', 'ізюм', 'izium'] },
  { oblast: 'Sumy oblast', coords: [34.800, 50.910], tokens: ['сумщ', 'сумськ', 'сумської', 'м. суми', 'sumy', 'шостк', 'конотоп'] },
  { oblast: 'Zaporizhzhia oblast', coords: [35.139, 47.838], tokens: ['запоріж', 'запорізьк', 'zaporizh', 'оріхів', 'оріхов', 'гуляйполе', 'huliaipole', 'токмак', 'tokmak'] },
  { oblast: 'Kherson oblast', coords: [32.601, 46.635], tokens: ['херсон', 'херсонщ', 'kherson', 'берислав'] },
  { oblast: 'Donetsk oblast', coords: [37.800, 48.000], tokens: ['донеччин', 'донецьк', 'donetsk', 'краматорськ', 'kramatorsk', "слов'янськ", 'покровськ', 'pokrovsk', 'костянтинівк', 'часів яр', 'торецьк', 'toretsk', 'авдіїв'] },
  { oblast: 'Dnipropetrovsk oblast', coords: [35.046, 48.465], tokens: ['дніпропетровщ', 'дніпро', 'нікополь', 'nikopol', 'кривий ріг', 'kryvyi rih', 'павлоград', 'марганець'] },
  { oblast: 'Chernihiv oblast', coords: [31.285, 51.498], tokens: ['чернігівщ', 'чернігів', 'chernihiv', 'новгород-сіверськ', 'семенівк'] },
  { oblast: 'Mykolaiv oblast', coords: [31.994, 46.975], tokens: ['миколаївщ', 'миколаїв', 'mykolaiv', 'очаків', 'снігурівк'] },
  { oblast: 'Poltava oblast', coords: [34.551, 49.588], tokens: ['полтавщ', 'полтав', 'poltava', 'кременчук', 'kremenchuk', 'лубни'] },
  { oblast: 'Luhansk oblast', coords: [39.300, 48.566], tokens: ['луганщ', 'луганськ', 'luhansk', 'luhans', 'рубіжн', 'сєвєродонецьк', 'лисичанськ'] },
  { oblast: 'Odesa oblast', coords: [30.723, 46.482], tokens: ['одещ', 'одеськ', 'odesa', 'odessa', 'ізмаїл', 'чорноморськ', 'южне'] },
  { oblast: 'Kyiv oblast', coords: [30.523, 50.450], tokens: ['київщ', 'київськ', 'kyiv', 'kyivsk', 'бровар', 'бориспіл', 'vasylkiv', 'васильків'] },
  { oblast: 'Zhytomyr oblast', coords: [28.658, 50.255], tokens: ['житомирщ', 'житомир', 'zhytomyr', 'бердичів', 'коростень'] },
  { oblast: 'Rivne oblast', coords: [26.251, 50.620], tokens: ['рівненщ', 'рівн', 'rivne', 'рівного', 'рівному'] },
  { oblast: 'Vinnytsia oblast', coords: [28.468, 49.233], tokens: ['вінниц', 'вінниці', 'vinnytsia', 'вінниця', 'жмеринк'] },
  { oblast: 'Khmelnytskyi oblast', coords: [26.987, 49.423], tokens: ['хмельниц', 'khmelnytsk', 'хмельницьк', 'кам\'янець'] },
  { oblast: 'Kirovohrad oblast', coords: [32.262, 48.508], tokens: ['кіровоград', 'kirovohrad', 'кропивниц', 'kropyvnytsk'] },
];

// Precompiled leading-boundary matchers per oblast. A token must start at a word
// boundary — so "оріхов" no longer fires inside "горіхове" (hazel) — but trailing
// letters are allowed because the tokens are declension stems ("запоріж" must
// still match "запоріжжя"). Compiled once, not per request.
const OBLAST_MATCHERS = OBLAST_REFS.map((ref) => ({
  ref,
  regexes: ref.tokens.map(
    (t) => new RegExp(`(?<![\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'iu')
  ),
}));

const WINDOW_HOURS = 1.5;
const WINDOW_MS = WINDOW_HOURS * 60 * 60 * 1000;
const CACHE_TTL_MS = 60_000;

interface KabThreat {
  oblast: string;
  regionName: string;
  level: 'oblast';
  alertType: 'KAB';
  lat: number;
  lng: number;
  count: number;
  startedAt: string; // ISO of the most recent mention
  text: string;      // snippet of the most recent mention
  sources: string[];
}

interface KabResponse {
  threats: KabThreat[];
  total: number;
  window_hours: number;
  timestamp: string;
}

interface TgMessage {
  text: string;
  ts: number; // epoch ms
}

let cached: KabResponse | null = null;
let cachedAt = 0;
let inflight: Promise<KabResponse> | null = null;

function isKab(text: string): boolean {
  return KAB_PATTERNS.some((re) => re.test(text));
}

function matchOblasts(lowerText: string): OblastRef[] {
  return OBLAST_MATCHERS.filter(({ regexes }) => regexes.some((re) => re.test(lowerText))).map(({ ref }) => ref);
}

// Extract { text, ts } per message from a Telegram /s/ HTML page.
function parseTelegramMessages(html: string): TgMessage[] {
  const out: TgMessage[] = [];
  const blocks = html.split('tgme_widget_message_wrap').slice(1);
  for (const block of blocks) {
    const textMatch = block.match(/<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/i);
    if (!textMatch) continue;
    const text = textMatch[1]
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .trim();
    if (!text || text.length < 8) continue;

    const dateMatch = block.match(/<time[^>]*datetime="([^"]+)"/i);
    const ts = dateMatch ? new Date(dateMatch[1]).getTime() : NaN;
    if (Number.isNaN(ts)) continue; // require a real timestamp for the recency window
    out.push({ text, ts });
  }
  return out;
}

async function fetchChannel(channel: string): Promise<TgMessage[]> {
  try {
    const res = await stealthFetch(`https://t.me/s/${channel}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    return parseTelegramMessages(await res.text());
  } catch {
    return [];
  }
}

async function buildThreats(): Promise<KabResponse> {
  const cutoff = Date.now() - WINDOW_MS;
  const results = await Promise.allSettled(UA_THREAT_CHANNELS.map((c) => fetchChannel(c).then((m) => ({ c, m }))));

  // oblast → aggregate
  const agg = new Map<string, { ref: OblastRef; count: number; latestTs: number; latestText: string; sources: Set<string> }>();

  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { c, m } = r.value;
    for (const msg of m) {
      if (msg.ts < cutoff) continue;
      if (!isKab(msg.text)) continue;
      const refs = matchOblasts(msg.text.toLowerCase());
      if (refs.length === 0) continue; // no location → can't place it

      for (const ref of refs) {
        const cur = agg.get(ref.oblast);
        if (!cur) {
          agg.set(ref.oblast, { ref, count: 1, latestTs: msg.ts, latestText: msg.text, sources: new Set([c]) });
        } else {
          cur.count += 1;
          cur.sources.add(c);
          if (msg.ts > cur.latestTs) {
            cur.latestTs = msg.ts;
            cur.latestText = msg.text;
          }
        }
      }
    }
  }

  const threats: KabThreat[] = Array.from(agg.values())
    .map((a) => ({
      oblast: a.ref.oblast,
      regionName: a.ref.oblast,
      level: 'oblast' as const,
      alertType: 'KAB' as const,
      lng: a.ref.coords[0],
      lat: a.ref.coords[1],
      count: a.count,
      startedAt: new Date(a.latestTs).toISOString(),
      text: a.latestText.length > 220 ? a.latestText.slice(0, 220) + '…' : a.latestText,
      sources: Array.from(a.sources).map((s) => `t.me/${s}`),
    }))
    .sort((x, y) => new Date(y.startedAt).getTime() - new Date(x.startedAt).getTime());

  return {
    threats,
    total: threats.length,
    window_hours: WINDOW_HOURS,
    timestamp: new Date().toISOString(),
  };
}

export async function GET() {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS) {
    return NextResponse.json(cached, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
    });
  }
  if (inflight) {
    try {
      return NextResponse.json(await inflight, {
        headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
      });
    } catch {
      return NextResponse.json({ threats: [], total: 0, window_hours: WINDOW_HOURS, error: 'Failed to fetch KAB threats' }, { status: 500 });
    }
  }

  inflight = buildThreats();
  try {
    const data = await inflight;
    cached = data;
    cachedAt = Date.now();
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
    });
  } catch (error) {
    console.error('[OSIRIS] KAB threat fetch error:', error);
    return NextResponse.json(
      { threats: [], total: 0, window_hours: WINDOW_HOURS, error: error instanceof Error ? error.message : 'Failed to fetch KAB threats' },
      { status: 500 },
    );
  } finally {
    inflight = null;
  }
}
