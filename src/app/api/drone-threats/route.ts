import { NextResponse } from 'next/server';
import { getThreatCorpus, classifyWeapons, matchOblasts, buildRoute } from '@/lib/telegram-threats';
import type { OblastRef, RouteWave } from '@/lib/telegram-threats';

export const dynamic = 'force-dynamic';

/**
 * OSIRIS — Drone Threat Signal (Telegram-derived)
 *
 * Thin route on top of the shared telegram-threats corpus.
 * Filters the 1.5-h message window for DRONE weapon mentions
 * (Shahed / Geran / БПЛА / drone-kamikaze patterns), then aggregates
 * one DroneEvent per affected oblast (keeping the most recent message).
 *
 * Cache: 60 s route-level (processed result).
 * The underlying corpus is cached 15 min in telegram-threats.ts, so actual
 * Telegram scrapes happen at most once per 15 min regardless of traffic.
 */

const WINDOW_HOURS = 1.5;
const CACHE_TTL_MS = 60_000; // 60 s — short because drone activity is fast-moving

interface DroneEvent {
  oblast:      string;
  regionName:  string;
  level:       'oblast';
  alertType:   'DRONE';
  lat:         number;
  lng:         number;
  count:       number;
  startedAt:   string;   // ISO of the most-recent mention
  text:        string;   // snippet ≤220 chars
  sources:     string[]; // e.g. ["t.me/war_monitor"]
}

interface DroneResponse {
  threats:      DroneEvent[];
  waves:        RouteWave[];   // one per distinct attack group; empty when no confirmed sightings
  total:        number;
  window_hours: number;
  timestamp:    string;
}

// ── module-level cache ───────────────────────────────────────────────────────

let cached:   DroneResponse | null = null;
let cachedAt                       = 0;
let inflight: Promise<DroneResponse> | null = null;

// ── builder ──────────────────────────────────────────────────────────────────

async function buildDroneResponse(): Promise<DroneResponse> {
  const messages = await getThreatCorpus();

  type AggEntry = {
    ref:        OblastRef;
    count:      number;
    latestTs:   number;
    latestText: string;
    sources:    Set<string>;
  };

  const agg = new Map<string, AggEntry>();

  for (const msg of messages) {
    if (!classifyWeapons(msg.text).includes('DRONE')) continue;
    const refs = matchOblasts(msg.text);
    if (refs.length === 0) continue;

    for (const ref of refs) {
      const cur = agg.get(ref.oblast);
      if (!cur) {
        agg.set(ref.oblast, {
          ref,
          count:      1,
          latestTs:   msg.ts,
          latestText: msg.text,
          sources:    new Set([msg.channel]),
        });
      } else {
        cur.count += 1;
        cur.sources.add(msg.channel);
        if (msg.ts > cur.latestTs) {
          cur.latestTs   = msg.ts;
          cur.latestText = msg.text;
        }
      }
    }
  }

  const threats: DroneEvent[] = Array.from(agg.values())
    .map((a) => ({
      oblast:     a.ref.oblast,
      regionName: a.ref.oblast,
      level:      'oblast' as const,
      alertType:  'DRONE'  as const,
      lng:        a.ref.coords[0],
      lat:        a.ref.coords[1],
      count:      a.count,
      startedAt:  new Date(a.latestTs).toISOString(),
      text:       a.latestText.length > 220 ? a.latestText.slice(0, 220) + '…' : a.latestText,
      sources:    Array.from(a.sources).map((s) => `t.me/${s}`),
    }))
    .sort((x, y) => new Date(y.startedAt).getTime() - new Date(x.startedAt).getTime());

  const waves = buildRoute(messages, 'DRONE');

  return {
    threats,
    waves,
    total:        threats.length,
    window_hours: WINDOW_HOURS,
    timestamp:    new Date().toISOString(),
  };
}

// ── route handler ────────────────────────────────────────────────────────────

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
      return NextResponse.json(
        { threats: [], total: 0, window_hours: WINDOW_HOURS, error: 'Failed to fetch drone threats' },
        { status: 500 },
      );
    }
  }

  inflight = buildDroneResponse();
  try {
    const data = await inflight;
    cached   = data;
    cachedAt = Date.now();
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
    });
  } catch (error) {
    console.error('[OSIRIS] drone-threats fetch error:', error);
    return NextResponse.json(
      {
        threats:      [],
        total:        0,
        window_hours: WINDOW_HOURS,
        error:        error instanceof Error ? error.message : 'Failed to fetch drone threats',
      },
      { status: 500 },
    );
  } finally {
    inflight = null;
  }
}
