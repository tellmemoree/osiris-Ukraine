'use client';

import { useState, useEffect, useRef } from 'react';
import { X, MapPin } from 'lucide-react';
import type { ThresholdAlert } from '@/app/api/threshold-alerts/route';

interface Props {
  alerts: ThresholdAlert[];
  onLocate?: (lat: number, lng: number) => void;
  onNewAlert?: (alert: ThresholdAlert) => void;
}

const SEV_COLOR: Record<string, string> = {
  CRITICAL: '#FF1744',
  HIGH: '#FF3D3D',
  ELEVATED: '#FF9500',
  LOW: '#00E676',
};

const AUTO_DISMISS_MS = 25_000;

function Toast({ alert, onDismiss, onLocate }: {
  alert: ThresholdAlert;
  onDismiss: () => void;
  onLocate?: (lat: number, lng: number) => void;
}) {
  const color = SEV_COLOR[alert.severity] ?? '#FFD700';
  const [progress, setProgress] = useState(100);
  const rafRef = useRef<number>(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    const tick = () => {
      const elapsed = Date.now() - startRef.current;
      const pct = Math.max(0, 100 - (elapsed / AUTO_DISMISS_MS) * 100);
      setProgress(pct);
      if (pct > 0) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        onDismiss();
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [onDismiss]);

  return (
    <div
      className="glass-panel pointer-events-auto overflow-hidden"
      style={{ width: 300, borderColor: `${color}33` }}
    >
      {/* Progress bar */}
      <div className="h-0.5 w-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div
          className="h-full transition-none"
          style={{ width: `${progress}%`, background: color, opacity: 0.6 }}
        />
      </div>

      <div className="px-3 py-2.5">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}80` }} />
            <span className="text-[9px] font-mono font-bold tracking-widest uppercase" style={{ color }}>
              {alert.rule}
            </span>
          </div>
          <button onClick={onDismiss} className="text-white/30 hover:text-white/60 flex-shrink-0">
            <X size={11} />
          </button>
        </div>

        <p className="text-[10px] font-mono font-semibold text-white/85 leading-snug mb-1">
          {alert.title}
        </p>
        <p className="text-[9px] font-mono text-white/45 leading-snug">
          {alert.description}
        </p>

        {alert.lat !== undefined && alert.lng !== undefined && onLocate && (
          <button
            onClick={() => onLocate(alert.lat!, alert.lng!)}
            className="mt-2 flex items-center gap-1 text-[8px] font-mono text-[var(--cyan-primary)] hover:underline"
          >
            <MapPin size={9} /> Fly to location
          </button>
        )}
      </div>
    </div>
  );
}

export default function ThresholdToasts({ alerts, onLocate, onNewAlert }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const alert of alerts) {
      if (!dismissed.has(alert.id) && !seenRef.current.has(alert.id)) {
        seenRef.current.add(alert.id);
        onNewAlert?.(alert);
      }
    }
  }, [alerts, dismissed, onNewAlert]);

  const visible = alerts.filter(a => !dismissed.has(a.id)).slice(0, 5);
  if (!visible.length) return null;

  return (
    <div className="absolute top-16 right-2 z-[400] flex flex-col gap-2 pointer-events-none">
      {visible.map(alert => (
        <Toast
          key={alert.id}
          alert={alert}
          onLocate={onLocate}
          onDismiss={() => setDismissed(prev => new Set([...prev, alert.id]))}
        />
      ))}
    </div>
  );
}
