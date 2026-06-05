import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fetchDeepState, extractFeatures } from '@/lib/deepstate';

export const dynamic = 'force-dynamic';

/**
 * OSIRIS — Frontline change tracker (2.1).
 *
 * DeepState's history list is auth-gated and past snapshots aren't fetchable by guess,
 * so we can't diff against an arbitrary past date. Instead we snapshot the current
 * frontline *footprint area* (sum of DeepState polygon areas) once per UTC day to a
 * local store and report deltas over the accumulated series — net expansion (RU
 * advance) or contraction (UA liberation) in km².
 *
 * NOTE: footprint = all DeepState polygons (occupied + contested), a proxy for the
 * RU-controlled footprint — the day-over-day DELTA is the signal, not the absolute.
 * The series starts empty and fills daily: deltas appear once 2+ daily snapshots exist.
 */

const DATA_DIR = path.join(os.homedir(), '.osiris-data');
const FILE = path.join(DATA_DIR, 'frontline-history.json');
const MAX_DAYS = 120;

interface Snap { date: string; areaKm2: number; features: number; }

// Equirectangular shoelace area (km²) for a [lng,lat] ring.
function ringAreaKm2(ring: number[][]): number {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  let latSum = 0;
  for (const p of ring) latSum += p[1];
  const k = Math.cos((latSum / ring.length) * Math.PI / 180);
  let a2 = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[(i + 1) % ring.length];
    a2 += (lng1 * k) * lat2 - (lng2 * k) * lat1;
  }
  return Math.abs(a2 / 2) * 111.32 * 111.32;
}

function geomAreaKm2(geom: { type?: string; coordinates?: unknown }): number {
  if (!geom?.coordinates) return 0;
  const coords = geom.coordinates as number[][][] | number[][][][];
  if (geom.type === 'Polygon') {
    const rings = coords as number[][][];
    if (!rings.length) return 0;
    return rings.reduce((s, ring, i) => s + (i === 0 ? ringAreaKm2(ring) : -ringAreaKm2(ring)), 0);
  }
  if (geom.type === 'MultiPolygon') {
    const polys = coords as number[][][][];
    return polys.reduce((s, rings) =>
      s + rings.reduce((ps, ring, i) => ps + (i === 0 ? ringAreaKm2(ring) : -ringAreaKm2(ring)), 0), 0);
  }
  return 0;
}

async function readHistory(): Promise<Snap[]> {
  try {
    const txt = await fs.readFile(FILE, 'utf8');
    const arr = JSON.parse(txt);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

async function writeHistory(snaps: Snap[]): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(snaps.slice(-MAX_DAYS)), 'utf8');
  } catch (e) { console.warn('[OSIRIS] frontline-changes: persist failed', e instanceof Error ? e.message : e); }
}

// Newest snapshot at or before `cutoffDate` (YYYY-MM-DD); else the earliest.
function snapBefore(series: Snap[], cutoffDate: string): Snap | null {
  let pick: Snap | null = null;
  for (const s of series) { if (s.date <= cutoffDate) pick = s; }
  return pick ?? series[0] ?? null;
}

export async function GET() {
  try {
    const deepStateData = await fetchDeepState();
    const features = extractFeatures(deepStateData) as { geometry?: { type?: string; coordinates?: unknown } }[];
    if (!features.length) {
      return NextResponse.json({ error: 'No frontline data available' }, { status: 502 });
    }

    const areaKm2 = Math.round(features.reduce((s, f) => s + geomAreaKm2(f.geometry || {}), 0));
    const today = new Date().toISOString().slice(0, 10);

    const history = await readHistory();
    const last = history[history.length - 1];
    if (last && last.date === today) {
      last.areaKm2 = areaKm2; last.features = features.length; // refresh today's
    } else {
      history.push({ date: today, areaKm2, features: features.length });
    }
    await writeHistory(history);

    const series = history.slice(-MAX_DAYS);
    const current = series[series.length - 1];
    const prev = series.length >= 2 ? series[series.length - 2] : null;
    const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 7);
    const weekAgoDate = d.toISOString().slice(0, 10);
    const weekRef = series.length >= 2 ? snapBefore(series.slice(0, -1), weekAgoDate) : null;

    return NextResponse.json({
      current: { date: current.date, areaKm2: current.areaKm2, features: current.features },
      delta_1d: prev ? current.areaKm2 - prev.areaKm2 : null,
      delta_7d: weekRef ? current.areaKm2 - weekRef.areaKm2 : null,
      since_date: weekRef?.date ?? null,
      series: series.map(s => ({ date: s.date, areaKm2: s.areaKm2 })),
      snapshots: series.length,
      note: series.length < 2 ? 'Tracking started — daily deltas appear after the next UTC day.' : undefined,
      timestamp: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' } });
  } catch (error) {
    console.error('frontline-changes error:', error);
    return NextResponse.json({ error: 'Failed to compute frontline changes' }, { status: 500 });
  }
}
