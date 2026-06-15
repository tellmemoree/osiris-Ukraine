import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const FILE = path.join(os.homedir(), '.osiris-data', 'air-raid-history.json');

export interface AlarmSnap { ts: string; active: string[]; }

export async function readAlarmHistory(): Promise<AlarmSnap[]> {
  try {
    const txt = await fs.readFile(FILE, 'utf8');
    const arr = JSON.parse(txt);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

// Returns true if `oblast` had an active air-raid alarm at any 5-min snapshot
// within the given window around `isoTs`. Uses lowercase comparison so
// "Kharkiv oblast" matches regardless of casing in the stored history.
export function isOblastAlarmed(
  oblast: string,
  isoTs: string,
  history: AlarmSnap[],
  windowBeforeMs = 45 * 60_000,
  windowAfterMs  = 45 * 60_000,
): boolean {
  const ts = new Date(isoTs).getTime();
  if (isNaN(ts) || history.length === 0) return false;
  const from = ts - windowBeforeMs;
  const to   = ts + windowAfterMs;
  const norm = oblast.toLowerCase();
  return history.some(snap => {
    const snapTs = new Date(snap.ts).getTime();
    if (isNaN(snapTs) || snapTs < from || snapTs > to) return false;
    return snap.active.some(a => a.toLowerCase() === norm);
  });
}
