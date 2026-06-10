import { NextResponse } from 'next/server';
import { stealthFetch } from '@/lib/stealthFetch';

export const dynamic = 'force-dynamic';

/**
 * OSIRIS — Russian Oblast Air Raid Alerts (Telegram-derived)
 *
 * No structured, keyless feed exists for Ukrainian cross-border strike alerts
 * on Russian border oblasts. Strike/drone incursion reports circulate as free
 * text in Russian OSINT and regional Telegram channels. This route scrapes
 * those channels, regex-detects alert mentions, attributes each message to a
 * Russian oblast by keyword, keeps only the 24-hour window, and returns one
 * event per oblast (the most recent matching message).
 *
 * This is an explicitly heuristic, text-derived signal — not a structured alert.
 * Channels that have disabled the t.me/s/ web preview are silently skipped.
 */

// RU-side channels that routinely report drone/strike incursions into border oblasts.
const RU_ALERT_CHANNELS = [
  'bazabazon',       // Baza — RU breaking news, reports drone incursions
  'mashnews',        // Mash — high-volume breaking news
  'shot_shot',       // Shot — Belgorod/Kursk/Bryansk focus
  'Molyar_Belgorod', // Belgorod regional
  'kursk_today',     // Kursk regional
  'voronezh_online', // Voronezh regional
];

// Alert detection patterns — Russian Cyrillic terms for drones, strikes, alarms.
// Require /u flag for \p{} and /i for case-insensitive Unicode matching.
const ALERT_TERMS: RegExp[] = [
  /дрон/iu,
  /бпла/iu,
  /атак/iu,
  /тревог/iu,        // тревога — alarm/warning
  /прилёт/iu,
  /прилет/iu,        // "arrival" — RU slang for impact
  /беспилотник/iu,
  /обстрел/iu,       // shelling
  /удар/iu,          // strike
];

interface RuOblastRef {
  oblast: string;
  lat: number;
  lng: number;
  tokens: string[]; // Cyrillic stems to match in message text
}

const RU_OBLAST_REFS: RuOblastRef[] = [
  { oblast: 'Belgorod Oblast',  lat: 50.595, lng: 36.587, tokens: ['белгород'] },
  { oblast: 'Kursk Oblast',     lat: 51.730, lng: 36.193, tokens: ['курск'] },
  { oblast: 'Bryansk Oblast',   lat: 53.243, lng: 34.364, tokens: ['брянск'] },
  { oblast: 'Voronezh Oblast',  lat: 51.672, lng: 39.184, tokens: ['воронеж'] },
  { oblast: 'Rostov Oblast',    lat: 47.222, lng: 39.720, tokens: ['ростов'] },
  { oblast: 'Krasnodar Krai',   lat: 45.039, lng: 38.987, tokens: ['краснодар', 'кубань'] },
  { oblast: 'Lipetsk Oblast',   lat: 52.609, lng: 39.599, tokens: ['липецк'] },
  { oblast: 'Tambov Oblast',    lat: 52.732, lng: 41.440, tokens: ['тамбов'] },
  { oblast: 'Saratov Oblast',   lat: 51.533, lng: 46.034, tokens: ['саратов'] },
  { oblast: 'Volgograd Oblast', lat: 48.708, lng: 44.513, tokens: ['волгоград'] },
];

// Precompile a leading-boundary regex per token. A token must start at a
// non-letter/non-digit position so "курский" matches "курск" but "закурск"
// does not. Trailing characters are allowed (tokens are stems). Compiled once.
const OBLAST_MATCHERS = RU_OBLAST_REFS.map((ref) => ({
  ref,
  regexes: ref.tokens.map(
    (t) =>
      new RegExp(
        `(?<![\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        'iu',
      ),
  ),
}));

const WINDOW_HOURS = 24;
const WINDOW_MS = WINDOW_HOURS * 60 * 60 * 1000;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes — event-based, not real-time state

export interface RuAlertEvent {
  oblast: string;
  lat: number;
  lng: number;
  started_at: string; // ISO of the most recent matching message
  source: string;     // e.g. "t.me/bazabazon"
  snippet: string;    // message text ≤200 chars
}

export interface RuAirRaidsResponse {
  events: RuAlertEvent[];
  total: number;
  window_hours: number;
  timestamp: string;
}

interface TgMessage {
  text: string;
  ts: number; // epoch ms
}

// Module-level cache + inflight coalescing — one pending Promise, not one per request.
let cached: RuAirRaidsResponse | null = null;
let cachedAt = 0;
let inflight: Promise<RuAirRaidsResponse> | null = null;

function isAlert(text: string): boolean {
  return ALERT_TERMS.some((re) => re.test(text));
}

function matchOblasts(text: string): RuOblastRef[] {
  return OBLAST_MATCHERS.filter(({ regexes }) =>
    regexes.some((re) => re.test(text)),
  ).map(({ ref }) => ref);
}

// Extract { text, ts } per message from a Telegram /s/ HTML page.
// If the channel owner has disabled web preview, the HTML contains no
// tgme_widget_message_wrap blocks and this returns [], which is silently skipped.
function parseTelegramMessages(html: string): TgMessage[] {
  const out: TgMessage[] = [];
  const blocks = html.split('tgme_widget_message_wrap').slice(1);
  for (const block of blocks) {
    const textMatch = block.match(
      /<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/i,
    );
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
    if (Number.isNaN(ts)) continue;
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

async function buildEvents(): Promise<RuAirRaidsResponse> {
  const cutoff = Date.now() - WINDOW_MS;
  const results = await Promise.allSettled(
    RU_ALERT_CHANNELS.map((c) => fetchChannel(c).then((m) => ({ c, m }))),
  );

  // oblast → most-recent matching message from any channel
  const agg = new Map<
    string,
    { ref: RuOblastRef; latestTs: number; latestText: string; source: string }
  >();

  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { c, m } = r.value;
    for (const msg of m) {
      if (msg.ts < cutoff) continue;
      if (!isAlert(msg.text)) continue;
      const refs = matchOblasts(msg.text);
      if (refs.length === 0) continue; // no location — can't place it

      for (const ref of refs) {
        const cur = agg.get(ref.oblast);
        if (!cur || msg.ts > cur.latestTs) {
          agg.set(ref.oblast, {
            ref,
            latestTs: msg.ts,
            latestText: msg.text,
            source: `t.me/${c}`,
          });
        }
      }
    }
  }

  const events: RuAlertEvent[] = Array.from(agg.values())
    .map((a) => ({
      oblast: a.ref.oblast,
      lat: a.ref.lat,
      lng: a.ref.lng,
      started_at: new Date(a.latestTs).toISOString(),
      source: a.source,
      snippet:
        a.latestText.length > 200
          ? a.latestText.slice(0, 200) + '…'
          : a.latestText,
    }))
    .sort(
      (x, y) =>
        new Date(y.started_at).getTime() - new Date(x.started_at).getTime(),
    );

  return {
    events,
    total: events.length,
    window_hours: WINDOW_HOURS,
    timestamp: new Date().toISOString(),
  };
}

export async function GET() {
  const now = Date.now();

  // Serve from module-level cache if still fresh.
  if (cached && now - cachedAt < CACHE_TTL_MS) {
    return NextResponse.json(cached, {
      headers: {
        'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800',
      },
    });
  }

  // Coalesce concurrent requests onto the single in-flight promise.
  if (inflight) {
    try {
      return NextResponse.json(await inflight, {
        headers: {
          'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800',
        },
      });
    } catch {
      return NextResponse.json(
        { events: [], total: 0, window_hours: WINDOW_HOURS, error: 'Upstream fetch failed' },
        { status: 500 },
      );
    }
  }

  inflight = buildEvents();
  try {
    const data = await inflight;
    cached = data;
    cachedAt = Date.now();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800',
      },
    });
  } catch (error) {
    console.error('[OSIRIS] RU air-raid fetch error:', error);
    // Serve stale on upstream failure — never serve empty if we have prior data.
    if (cached) {
      return NextResponse.json(cached, {
        headers: {
          'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800',
        },
      });
    }
    return NextResponse.json(
      {
        events: [],
        total: 0,
        window_hours: WINDOW_HOURS,
        error: 'Failed to fetch RU air-raid alerts',
      },
      { status: 500 },
    );
  } finally {
    inflight = null;
  }
}
