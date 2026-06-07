'use client';

import { useRef } from 'react';
import { X, Bell, MapPin, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { ThresholdAlert } from '@/app/api/threshold-alerts/route';

export interface NotificationRecord extends ThresholdAlert {
  seenAt: number; // Date.now() when it appeared
}

const SEV_COLOR: Record<string, string> = {
  CRITICAL: '#FF1744',
  HIGH: '#FF3D3D',
  ELEVATED: '#FF9500',
  LOW: '#00E676',
};

function relativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  notifications: NotificationRecord[];
  onClear: () => void;
  onLocate?: (lat: number, lng: number) => void;
}

export default function NotificationDrawer({ isOpen, onClose, notifications, onClear, onLocate }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="notif-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-[440]"
            style={{ background: 'rgba(0,0,0,0.35)' }}
          />

          {/* Drawer */}
          <motion.div
            key="notif-drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.25, ease: 'easeInOut' }}
            className="fixed z-[450] flex flex-col"
            style={{
              top: 56,
              right: 0,
              bottom: 0,
              width: 340,
              background: 'rgba(10,12,20,0.96)',
              backdropFilter: 'blur(20px)',
              borderLeft: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            {/* Header */}
            <div
              className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
            >
              <Bell className="w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0" />
              <span className="flex-1 text-[9px] font-mono font-bold tracking-widest uppercase text-[var(--text-muted)]">
                Notification Log
              </span>
              {notifications.length > 0 && (
                <span
                  className="min-w-[18px] h-[18px] px-1 rounded-full text-[8px] font-mono font-bold flex items-center justify-center text-white"
                  style={{ background: '#FF3D3D' }}
                >
                  {notifications.length > 99 ? '99+' : notifications.length}
                </span>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={onClear}
                  title="Clear all"
                  className="ml-1 text-[var(--text-muted)] hover:text-white transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
              <button
                onClick={onClose}
                title="Close"
                className="ml-1 text-[var(--text-muted)] hover:text-white transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* List */}
            <div ref={listRef} className="flex-1 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40">
                  <Bell className="w-8 h-8 text-[var(--text-muted)]" />
                  <span className="text-[10px] font-mono text-[var(--text-muted)] tracking-widest">No alerts yet</span>
                </div>
              ) : (
                <div className="flex flex-col">
                  {notifications.map((notif, i) => {
                    const color = SEV_COLOR[notif.severity] ?? '#FFD700';
                    return (
                      <div
                        key={notif.id}
                        className="px-4 py-3"
                        style={{
                          borderBottom: i < notifications.length - 1
                            ? '1px solid rgba(255,255,255,0.05)'
                            : undefined,
                        }}
                      >
                        {/* Top row: severity dot + badge + timestamp */}
                        <div className="flex items-center gap-1.5 mb-1">
                          <div
                            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                            style={{ background: color, boxShadow: `0 0 5px ${color}80` }}
                          />
                          <span
                            className="text-[8px] font-mono font-bold tracking-widest uppercase"
                            style={{ color }}
                          >
                            {notif.severity}
                          </span>
                          <span className="flex-1" />
                          <span className="text-[8px] font-mono text-white/30 tabular-nums">
                            {relativeTime(notif.seenAt)}
                          </span>
                        </div>

                        {/* Rule */}
                        <p className="text-[8px] font-mono tracking-widest uppercase text-white/35 mb-0.5">
                          {notif.rule}
                        </p>

                        {/* Title */}
                        <p className="text-[11px] font-mono font-semibold text-white/85 leading-snug mb-0.5">
                          {notif.title}
                        </p>

                        {/* Description */}
                        <p className="text-[9px] font-mono text-white/40 leading-snug">
                          {notif.description}
                        </p>

                        {/* Fly-to */}
                        {notif.lat !== undefined && notif.lng !== undefined && onLocate && (
                          <button
                            onClick={() => onLocate(notif.lat!, notif.lng!)}
                            className="mt-1.5 flex items-center gap-1 text-[8px] font-mono text-[var(--cyan-primary)] hover:underline"
                          >
                            <MapPin className="w-2.5 h-2.5" />
                            FLY TO
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
