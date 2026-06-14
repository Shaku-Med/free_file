import { useState, useRef, useEffect } from 'react';
import { usePlayerContext } from '../../PlayerContext';

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export default function PlaybackSpeed() {
  const { state, setPlaybackRate } = usePlayerContext();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className="px-1.5 py-1 text-xs font-medium text-white hover:bg-white/10 rounded transition-colors min-w-[36px]"
        aria-label="Playback speed"
      >
        {state.playbackRate === 1 ? '1x' : `${state.playbackRate}x`}
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 py-1 min-w-[100px] bg-black/95 rounded-lg shadow-xl z-50">
          {SPEEDS.map(s => (
            <button
              key={s}
              onClick={() => { setPlaybackRate(s); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-white/10 transition-colors ${
                state.playbackRate === s ? 'text-sky-400 font-medium' : 'text-white'
              }`}
            >
              {s === 1 ? 'Normal' : `${s}x`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
