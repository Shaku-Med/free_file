import { useState, useRef, useEffect } from 'react';
import { usePlayerContext } from '../../PlayerContext';

export default function QualityMenu() {
  const { state, setQualityLevel } = usePlayerContext();
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

  if (state.levels.length <= 1) return null;

  const currentLabel = state.currentLevel === -1
    ? 'Auto'
    : `${state.levels[state.currentLevel]?.height}p`;

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className="px-1.5 py-1 text-xs font-medium text-white hover:bg-white/10 rounded transition-colors"
        aria-label="Quality"
      >
        {currentLabel}
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 py-1 min-w-[120px] bg-black/95 rounded-lg shadow-xl z-50">
          <button
            onClick={() => { setQualityLevel(-1); setOpen(false); }}
            className={`w-full text-left px-3 py-1.5 text-sm hover:bg-white/10 transition-colors ${
              state.currentLevel === -1 ? 'text-sky-400 font-medium' : 'text-white'
            }`}
          >
            Auto
          </button>
          {[...state.levels]
            .map((l, i) => ({ ...l, i }))
            .sort((a, b) => b.height - a.height)
            .map(({ height, i }) => (
              <button
                key={`${height}-${i}`}
                onClick={() => { setQualityLevel(i); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-white/10 transition-colors ${
                  state.currentLevel === i ? 'text-sky-400 font-medium' : 'text-white'
                }`}
              >
                {height}p
              </button>
            ))}
        </div>
      )}
    </div>
  );
}