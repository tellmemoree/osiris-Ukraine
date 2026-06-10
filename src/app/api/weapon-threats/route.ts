import { NextResponse } from 'next/server';
import { getThreatCorpus, classifyWeapons, matchOblasts } from '@/lib/telegram-threats';
import type { OblastRef, WeaponType } from '@/lib/telegram-threats';

export const dynamic = 'force-dynamic';

/**
 * OSIRIS — Weapon Threat Signal (Telegram-derived)
 *
 * Thin route on top of the shared telegram-threats corpus.
 * Classifies all weapon types across the 1.5-h message window and produces
 * one WeaponThreat entry per (oblast × weaponType) combination.
 *
 * Cache: 60 s route-level (processed result).
 * The underlying corpus is cached 15 min in telegram-threats.ts, so actual
 * Telegram scrapes happen at most once per 15 min regardless of traffic.
 */

const WINDOW_HOURS = 1.5;
const CACHE_TTL_MS = 60_000; // 60 s — weapon activity is fast-moving

interface WeaponThreat {
  oblast:      string;
  regionName:  string;
  level:       'oblast';
  weaponType:  WeaponType;
  lat:         number;
  lng:         number;
  count:       number;
  startedAt:   string;   // ISO of the most-recent mention
  text:        string;   // snippet ≤220 chars
  sources:     string[]; // e.g. ["t.me/war_monitor"]
}

interface WeaponResponse {
  threats:      WeaponThreat[];
  total:        number;
  window_hours: number;
  timestamp:    string;
}

// ── module-level cache ───────────────────────────────────────────────────────

let cached:   WeaponResponse | null = null;
let cachedAt                        = 0;
let inflight: Promise<WeaponResponse> | null = null;

// ── builder ──────────────────────────────────────────────────────────────────

async function buildWeaponResponse(): Promise<WeaponResponse> {
  const messages = await getThreatCorpus();

  // Composite key: "oblast||weaponType"
  type AggEntry = {
    ref:        OblastRef;
    weaponType: WeaponType;
    count:      number;
    latestTs:   number;
    latestText: string;
    sources:    Set<string>;
  };

  const agg = new Map<string, AggEntry>();

  for (const msg of messages) {
    const weapons = classifyWeapons(msg.text);
    if (weapons.length === 0) continue;
    const refs = matchOblasts(msg.text);
    if (refs.length === 0) continue;

    for (const ref of refs) {
      for (const wt of weapons) {
        const key = `${ref.oblast}||${wt}`;
        const cur = agg.get(key);
        if (!cur) {
          agg.set(key, {
            ref,
            weaponType: wt,
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
  }

  const threats: WeaponThreat[] = Array.from(agg.values())
    .map((a) => ({
      oblast:     a.ref.oblast,
      regionName: a.ref.oblast,
      level:      'oblast'    as const,
      weaponType: a.weaponType,
      lng:        a.ref.coords[0],
      lat:        a.ref.coords[1],
      count:      a.count,
      startedAt:  new Date(a.latestTs).toISOString(),
      text:       a.latestText.length > 220 ? a.latestText.slice(0, 220) + '…' : a.latestText,
      sources:    Array.from(a.sources).map((s) => `t.me/${s}`),
    }))
    .sort((x, y) => new Date(y.startedAt).getTime() - new Date(x.startedAt).getTime());

  return {
    threats,
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
        { threats: [], total: 0, window_hours: WINDOW_HOURS, error: 'Failed to fetch weapon threats' },
        { status: 500 },
      );
    }
  }

  inflight = buildWeaponResponse();
  try {
    const data = await inflight;
    cached   = data;
    cachedAt = Date.now();
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
    });
  } catch (error) {
    console.error('[OSIRIS] weapon-threats fetch error:', error);
    return NextResponse.json(
      {
        threats:      [],
        total:        0,
        window_hours: WINDOW_HOURS,
        error:        error instanceof Error ? error.message : 'Failed to fetch weapon threats',
      },
      { status: 500 },
    );
  } finally {
    inflight = null;
  }
}
