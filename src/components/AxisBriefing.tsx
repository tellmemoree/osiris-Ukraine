'use client';

import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import type { AxisBriefingResponse, AxisData, NewsItem } from '@/app/api/axis-briefing/route';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AxisBriefingProps {
  show: boolean;
}

// ---------------------------------------------------------------------------
// Constants — match FrontlineTracker.tsx glass-card style
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const GOLD = '#FFD24A';
const CYAN = '#00BCD4';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function HeadlineList({ news, expanded }: { news: NewsItem[]; expanded: boolean }) {
  const visible = expanded ? news : news.slice(0, 3);
  if (!visible.length) {
    return <p className="text-[10px] text-white/30 italic">No recent reports</p>;
  }
  return (
    <ul className="space-y-0.5 mt-1">
      {visible.map((item, i) => (
        <li key={i} className="text-[10px] leading-tight">
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate block max-w-full hover:underline"
              style={{ color: CYAN }}
              title={item.title}
            >
              {item.title}
            </a>
          ) : (
            <span className="truncate block max-w-full" style={{ color: CYAN }}>
              {item.title}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function AxisRow({ axis }: { axis: AxisData }) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = axis.news.length > 3;

  return (
    <div
      className="border-t border-white/10 pt-2 mt-2 first:border-t-0 first:pt-0 first:mt-0"
    >
      {/* Header row — click to expand */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex items-baseline justify-between w-full text-left gap-2 group"
      >
        <span className="text-[11px] font-bold text-white/80 group-hover:text-white transition-colors">
          {axis.name}
        </span>
        <span
          className="font-mono tabular-nums text-[11px] shrink-0"
          style={{ color: GOLD }}
        >
          {axis.areaKm2.toLocaleString()} km²
        </span>
      </button>

      {/* Headlines */}
      <HeadlineList news={axis.news} expanded={expanded} />

      {/* Show more / less toggle */}
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="text-[9px] text-white/30 hover:text-white/60 mt-1 transition-colors"
        >
          {expanded ? 'show less' : `+${axis.news.length - 3} more`}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AxisBriefing({ show }: AxisBriefingProps) {
  const [data, setData] = useState<AxisBriefingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    if (!show) return;

    let timer: ReturnType<typeof setInterval>;

    const load = () => {
      setLoading((prev) => (data === null ? true : prev)); // only show spinner on first load
      fetch('/api/axis-briefing')
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<AxisBriefingResponse>;
        })
        .then((j) => {
          if (!aliveRef.current) return;
          setData(j);
          setError(null);
          setLoading(false);
        })
        .catch((e: unknown) => {
          if (!aliveRef.current) return;
          setError((e instanceof Error ? e.message : 'Fetch failed'));
          setLoading(false);
        });
    };

    load();
    timer = setInterval(load, POLL_INTERVAL_MS);

    return () => {
      aliveRef.current = false;
      clearInterval(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  if (!show) return null;

  return (
    <div
      className={[
        'pointer-events-auto rounded-xl border border-white/10',
        'bg-black/70 px-4 py-3 backdrop-blur-md shadow-2xl',
        // Desktop: fixed width; mobile: full width (caller controls positioning)
        'w-full sm:w-[260px]',
      ].join(' ')}
    >
      {/* Panel header */}
      <div className="mb-2 flex items-center gap-2">
        <MapPin size={13} strokeWidth={2.5} style={{ color: '#FF3D3D' }} />
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">
          Axis Briefing
        </span>
        {data && (
          <span className="ml-auto text-[9px] text-white/25 tabular-nums">
            {new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {/* Body */}
      {loading && !data && (
        <p className="text-[10px] text-white/40 animate-pulse">Loading axis data…</p>
      )}

      {!loading && error && !data && (
        <p className="text-[10px] text-red-400/70">{error}</p>
      )}

      {data && data.axes.length > 0 && (
        <div>
          {data.axes.map((axis) => (
            <AxisRow key={axis.name} axis={axis} />
          ))}
        </div>
      )}

      {data && data.axes.length === 0 && (
        <p className="text-[10px] text-white/30">No axis data available.</p>
      )}

      <div className="mt-2.5 border-t border-white/10 pt-2 text-[9px] leading-snug text-white/30">
        Area = DeepState occupied polygons · News = Telegram OSINT
      </div>
    </div>
  );
}
