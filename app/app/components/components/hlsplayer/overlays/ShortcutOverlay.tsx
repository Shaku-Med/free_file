interface ShortcutOverlayProps {
  onClose: () => void;
  /** When false (guest watch), omit theater / mini-player bindings. */
  authPlaybackFeatures?: boolean;
}

const SHORTCUTS_ALWAYS = [
  { keys: ['Space', 'K'], desc: 'Play / Pause' },
  { keys: ['J', '←'], desc: 'Rewind 5s' },
  { keys: ['L', '→'], desc: 'Forward 5s' },
  { keys: ['↑'], desc: 'Volume up' },
  { keys: ['↓'], desc: 'Volume down' },
  { keys: ['M'], desc: 'Mute / Unmute' },
  { keys: ['F'], desc: 'Fullscreen' },
  { keys: ['<'], desc: 'Decrease speed' },
  { keys: ['>'], desc: 'Increase speed' },
  { keys: ['?'], desc: 'Show shortcuts' },
];

const SHORTCUTS_AUTH_ONLY = [
  { keys: ['T'], desc: 'Theater mode' },
  { keys: ['I'], desc: 'Mini player' },
];

export default function ShortcutOverlay({
  onClose,
  authPlaybackFeatures = true,
}: ShortcutOverlayProps) {
  const shortcuts = authPlaybackFeatures
    ? [...SHORTCUTS_ALWAYS.slice(0, 7), ...SHORTCUTS_AUTH_ONLY, ...SHORTCUTS_ALWAYS.slice(7)]
    : SHORTCUTS_ALWAYS;

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900/95 border border-white/10 rounded-xl shadow-2xl backdrop-blur-md p-5 max-w-sm w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-white text-sm font-semibold mb-3">Keyboard shortcuts</h3>
        <div className="space-y-1.5">
          {shortcuts.map(({ keys, desc }) => (
            <div key={desc} className="flex items-center justify-between gap-3">
              <span className="text-white/70 text-xs">{desc}</span>
              <span className="flex items-center gap-1">
                {keys.map((k) => (
                  <kbd
                    key={k}
                    className="min-w-[24px] px-1.5 py-0.5 text-[11px] font-mono font-medium text-white bg-white/10 border border-white/15 rounded text-center"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
        <p className="text-white/30 text-[10px] mt-3 text-center">
          Press <kbd className="px-1 py-0.5 bg-white/10 rounded text-[10px]">?</kbd> or <kbd className="px-1 py-0.5 bg-white/10 rounded text-[10px]">Esc</kbd> to close
        </p>
      </div>
    </div>
  );
}
