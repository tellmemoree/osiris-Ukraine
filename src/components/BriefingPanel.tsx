'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Send, CheckCircle, XCircle, Clock } from 'lucide-react';

interface DigestData {
  text: string;
  generatedAt: string;
  telegramSent: boolean;
  fromCache: boolean;
}

export default function BriefingPanel() {
  const [digest, setDigest] = useState<DigestData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/digest${force ? '?force=1' : ''}`);
      if (!res.ok) throw new Error(String(res.status));
      const j = await res.json();
      setDigest(j);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const age = digest
    ? Math.round((Date.now() - new Date(digest.generatedAt).getTime()) / 60_000)
    : null;

  return (
    <div className="glass-panel pointer-events-auto flex flex-col overflow-hidden" style={{ width: 360, maxHeight: '70vh' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 bg-black/30 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--cyan-primary)] animate-osiris-pulse" />
          <span className="text-[10px] font-mono font-semibold tracking-widest text-white/70 uppercase">Intel Digest</span>
        </div>
        <div className="flex items-center gap-2">
          {digest && (
            <span className="text-[9px] font-mono text-white/30 flex items-center gap-1">
              <Clock size={9} />
              {age === 0 ? 'just now' : `${age}m ago`}
            </span>
          )}
          <button
            onClick={() => load(true)}
            disabled={loading}
            title="Regenerate"
            className="hover:text-white/80 text-white/40 transition-colors disabled:opacity-30"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto styled-scrollbar px-3 py-2.5">
        {loading && !digest && (
          <div className="flex items-center justify-center py-8 text-[10px] font-mono text-white/30">
            <RefreshCw size={12} className="animate-spin mr-2" /> Generating digest…
          </div>
        )}
        {error && (
          <div className="text-[10px] font-mono text-[#FF3D3D] py-4 text-center">
            Failed to load digest. Retry ↻
          </div>
        )}
        {digest && (
          <pre className="text-[10px] font-mono text-white/75 leading-relaxed whitespace-pre-wrap break-words">
            {digest.text}
          </pre>
        )}
      </div>

      {/* Footer */}
      {digest && (
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-white/5 bg-black/20 flex-shrink-0">
          <span className="text-[8px] font-mono text-white/25">
            {new Date(digest.generatedAt).toUTCString().replace(' GMT', 'Z')}
            {digest.fromCache && ' · cached'}
          </span>
          {digest.telegramSent ? (
            <span className="flex items-center gap-1 text-[8px] font-mono text-[var(--alert-green)]">
              <CheckCircle size={9} /> TG sent
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[8px] font-mono text-white/20">
              <Send size={9} />
              {process.env.NEXT_PUBLIC_TG_ENABLED === '1' ? 'TG configured' : 'TG not set'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
