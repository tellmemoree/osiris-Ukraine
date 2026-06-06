import { NextRequest, NextResponse } from 'next/server';
import { createGeminiClient } from '@/lib/ai-engine';
import { sendTelegramMessage, telegramConfigured } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

const CACHE_TTL = 3_600_000; // 1 h
let cache: { text: string; generatedAt: string; telegramSent: boolean } | null = null;
let cacheTs = 0;

function getGeminiKey(): string | null {
  for (let i = 1; i <= 8; i++) {
    const k = process.env[`GEMINI_API_KEY_${i}`];
    if (k?.trim()) return k.trim();
  }
  return null;
}

function distKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dlat = lat2 - lat1;
  const dlng = (lng2 - lng1) * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.sqrt(dlat * dlat + dlng * dlng) * 111.32;
}

const CHOKEPOINTS = [
  { name: 'Bosphorus', lat: 41.12, lng: 29.07 },
  { name: 'Dardanelles', lat: 40.15, lng: 26.39 },
  { name: 'Kerch Strait', lat: 45.38, lng: 36.63 },
  { name: 'Suez Canal', lat: 30.58, lng: 32.35 },
  { name: 'Strait of Gibraltar', lat: 35.99, lng: -5.62 },
];

interface ShadowEntry { ship: Record<string, unknown>; chokepoint: string }

function buildDigestPrompt(p: {
  news: Record<string, unknown>[];
  airRaids: Record<string, unknown>[];
  kabThreats: Record<string, unknown>[];
  shadowFleet: ShadowEntry[];
  frontline: { areaKm2: number; delta_1d: number | null; delta_7d: number | null } | null;
}): string {
  const lines: string[] = [`[UTC ${new Date().toISOString()}]`];

  lines.push(`\n[FRONTLINE FOOTPRINT]`);
  if (p.frontline) {
    const d1 = p.frontline.delta_1d;
    const d7 = p.frontline.delta_7d;
    lines.push(`  ${p.frontline.areaKm2.toLocaleString()} km² occupied | 24h: ${d1 !== null ? (d1 >= 0 ? '+' : '') + d1 : '—'} km² | 7d: ${d7 !== null ? (d7 >= 0 ? '+' : '') + d7 : '—'} km²`);
  } else {
    lines.push('  Unavailable');
  }

  lines.push(`\n[AIR RAID ALERTS — ${p.airRaids.length} active oblasts]`);
  for (const r of p.airRaids.slice(0, 15)) {
    lines.push(`  ${r.oblast ?? r.regionName} | ${r.alertType} | since ${r.startedAt}`);
  }

  lines.push(`\n[KAB GLIDE BOMB THREATS — ${p.kabThreats.length} active]`);
  for (const k of p.kabThreats.slice(0, 10)) {
    lines.push(`  ${k.oblast} | ${k.text ?? k.alertType} | ${k.startedAt}`);
  }

  if (p.shadowFleet.length > 0) {
    lines.push(`\n[SHADOW FLEET — ${p.shadowFleet.length} vessel(s) near strategic chokepoints]`);
    for (const { ship, chokepoint } of p.shadowFleet.slice(0, 8)) {
      lines.push(`  ${ship.name ?? ship.mmsi} (${ship.flag}) | near ${chokepoint} | ${ship.speed}kt | dest ${ship.destination ?? '?'}`);
    }
  }

  lines.push(`\n[OSINT NEWS — ${p.news.length} items, top 15 by risk score]`);
  for (const n of p.news.slice(0, 15)) {
    lines.push(`  RISK:${n.risk_score ?? '?'}/10 | ${n.source} | ${n.title}`);
  }

  return `You are OSIRIS Intelligence Analyst. Generate a concise hourly situation digest for an operator monitoring the Russia-Ukraine conflict and global security.

OPERATIONAL DATA:
${lines.join('\n')}

TASK: Produce a tight, professional 10–15 line digest. Rules:
- Lead with the most operationally significant items
- Use bullet points (•)
- Prefix each domain: [FRONTLINE] [AIR RAIDS] [KAB] [MARITIME] [INTEL]
- Tag each domain severity: CRITICAL / HIGH / ELEVATED / STABLE
- No hedging or filler — facts only
- Close with a 1-sentence overall threat assessment
- Max 400 words`;
}

function buildRawSummary(p: {
  news: Record<string, unknown>[];
  airRaids: Record<string, unknown>[];
  kabThreats: Record<string, unknown>[];
  shadowFleet: ShadowEntry[];
  frontline: { areaKm2: number; delta_1d: number | null; delta_7d: number | null } | null;
}): string {
  const parts: string[] = [];
  if (p.frontline) {
    const d1 = p.frontline.delta_1d;
    parts.push(`• [FRONTLINE] ${p.frontline.areaKm2.toLocaleString()} km²${d1 !== null ? ` | 24h: ${d1 >= 0 ? '+' : ''}${d1} km²` : ''}`);
  }
  if (p.airRaids.length) {
    const oblasts = p.airRaids.slice(0, 5).map(r => r.oblast ?? r.regionName).join(', ');
    parts.push(`• [AIR RAIDS] ${p.airRaids.length} active — ${oblasts}${p.airRaids.length > 5 ? '…' : ''}`);
  }
  if (p.kabThreats.length) {
    parts.push(`• [KAB] ${p.kabThreats.length} active threat(s) — ${p.kabThreats.map(k => k.oblast).join(', ')}`);
  }
  if (p.shadowFleet.length) {
    parts.push(`• [MARITIME] ${p.shadowFleet.length} shadow-fleet vessel(s) near strategic chokepoint(s)`);
  }
  if (p.news.length) {
    parts.push(`• [INTEL] ${p.news.length} OSINT items — top: ${p.news[0]?.title ?? '—'}`);
  }
  if (!parts.length) parts.push('• No significant activity detected.');
  parts.push('\n⚠ Gemini not configured — raw summary only. Set GEMINI_API_KEY_1 for AI digest.');
  return parts.join('\n');
}

export async function GET(req: NextRequest) {
  const force = new URL(req.url).searchParams.has('force');
  const now = Date.now();

  if (!force && cache && now - cacheTs < CACHE_TTL) {
    return NextResponse.json({ ...cache, fromCache: true });
  }

  const base = new URL(req.url).origin;
  const toJson = (r: Response) => r.ok ? r.json() as Promise<Record<string, unknown>> : Promise.resolve({} as Record<string, unknown>);
  const [newsR, airR, kabR, maritimeR, frontlineR] = await Promise.allSettled([
    fetch(new URL('/api/news', base).href).then(toJson),
    fetch(new URL('/api/air-raids', base).href).then(toJson),
    fetch(new URL('/api/kab-threats', base).href).then(toJson),
    fetch(new URL('/api/maritime', base).href).then(toJson),
    fetch(new URL('/api/frontline-changes', base).href).then(r => r.ok ? r.json() as Promise<Record<string, unknown>> : Promise.resolve(null)),
  ]);

  const news: Record<string, unknown>[] = newsR.status === 'fulfilled' ? ((newsR.value.news ?? newsR.value.items ?? []) as Record<string, unknown>[]) : [];
  const airRaids: Record<string, unknown>[] = airR.status === 'fulfilled' ? ((airR.value.alerts ?? []) as Record<string, unknown>[]) : [];
  const kabThreats: Record<string, unknown>[] = kabR.status === 'fulfilled' ? ((kabR.value.threats ?? []) as Record<string, unknown>[]) : [];
  const ships: Record<string, unknown>[] = maritimeR.status === 'fulfilled' ? ((maritimeR.value.ships ?? []) as Record<string, unknown>[]) : [];
  const frontlineRaw = frontlineR.status === 'fulfilled' ? frontlineR.value : null;

  news.sort((a, b) => ((b.risk_score as number) ?? 0) - ((a.risk_score as number) ?? 0));

  const shadowFleet: ShadowEntry[] = [];
  for (const ship of ships) {
    if (!ship.shadow_fleet) continue;
    for (const cp of CHOKEPOINTS) {
      if (distKm(ship.lat as number, ship.lng as number, cp.lat, cp.lng) < 200) {
        shadowFleet.push({ ship, chokepoint: cp.name });
        break;
      }
    }
  }

  const fr = frontlineRaw as Record<string, unknown> | null;
  const frCurrent = fr?.current as Record<string, unknown> | undefined;
  const frontline = frCurrent
    ? {
        areaKm2: frCurrent.areaKm2 as number,
        delta_1d: (fr?.delta_1d ?? null) as number | null,
        delta_7d: (fr?.delta_7d ?? null) as number | null,
      }
    : null;

  const geminiKey = getGeminiKey();
  let text: string;
  let telegramSent = false;

  if (geminiKey) {
    try {
      const client = createGeminiClient(geminiKey);
      const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const prompt = buildDigestPrompt({ news, airRaids, kabThreats, shadowFleet, frontline });
      const result = await model.generateContent(prompt);
      text = result.response.text();

      if (telegramConfigured()) {
        const msg = `🛡️ <b>OSIRIS INTEL DIGEST</b>\n<i>${new Date().toUTCString()}</i>\n\n${text.slice(0, 3800)}\n\n<i>~hourly update</i>`;
        telegramSent = await sendTelegramMessage(msg);
      }
    } catch (e) {
      console.error('[OSIRIS] Digest Gemini error:', e instanceof Error ? e.message : e);
      text = buildRawSummary({ news, airRaids, kabThreats, shadowFleet, frontline });
    }
  } else {
    text = buildRawSummary({ news, airRaids, kabThreats, shadowFleet, frontline });
  }

  const generatedAt = new Date().toISOString();
  cache = { text, generatedAt, telegramSent };
  cacheTs = now;

  return NextResponse.json({ text, generatedAt, telegramSent, fromCache: false }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
