import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Settings,
  ChevronRight,
  BarChart3,
  Monitor,
  Moon,
  Gauge,
  Signal,
  PlayCircle,
  Repeat,
} from 'lucide-react';
import { usePlayerContext } from '../../PlayerContext';
import { cn } from '~/lib/utils';

const SETTINGS_PANEL_GAP = 8;
const VIEWPORT_PADDING = 16;
/** Prefer opening above when space below is less than this. */
const MIN_SPACE_BELOW_TO_OPEN_DOWN = 320;
const PANEL_MAX_HEIGHT_RATIO = 0.6;

type Panel = 'main' | 'speed' | 'quality' | 'sleep';

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const SLEEP_OPTIONS = ['Off', '5 min', '10 min', '15 min', '30 min', '45 min', '1 hour', 'End of video'];

function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200',
        checked ? 'bg-primary' : 'bg-secondary'
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-4 w-3.5 translate-y-0.5 rounded-full border-2 border-primary bg-background shadow transition-transform duration-200',
          checked ? 'translate-x-4' : 'translate-x-1'
        )}
      />
    </button>
  );
}

interface SettingsMenuProps {
  /** When true, render as expandable section inside parent (e.g. overflow dropdown). No portal. */
  nested?: boolean;
  panelRef?: React.RefObject<HTMLDivElement | null>;
  onOpenChange?: (open: boolean) => void;
}

export default function SettingsMenu({ nested, panelRef, onOpenChange }: SettingsMenuProps) {
  const { state, setPlaybackRate, setQualityLevel, ambientMode, setAmbientMode, autoPlay, setAutoPlay, loop, setLoop, stableVolume, setStableVolume } = usePlayerContext();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>('main');
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelElRef = useRef<HTMLDivElement>(null);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});
  const [sleepTimer, setSleepTimer] = useState('Off');

  useEffect(() => {
    if (nested || !open) return;
    const handle = (e: MouseEvent) => {
      const target = e.target as Node;
      const inTrigger = menuRef.current?.contains(target);
      const inPanel = panelElRef.current?.contains(target);
      if (!inTrigger && !inPanel) {
        setOpen(false);
        setPanel('main');
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [nested, open]);

  useEffect(() => {
    if (nested || !open || !triggerRef.current || typeof document === 'undefined') return;
    const btn = triggerRef.current.getBoundingClientRect();
    const panelWidth = 240;
    const padding = VIEWPORT_PADDING;
    let left = btn.right - panelWidth;
    left = Math.max(padding, Math.min(left, window.innerWidth - panelWidth - padding));
    const spaceBelow = window.innerHeight - btn.bottom - SETTINGS_PANEL_GAP - padding;
    const spaceAbove = btn.top - SETTINGS_PANEL_GAP - padding;
    const openAbove = spaceBelow < MIN_SPACE_BELOW_TO_OPEN_DOWN || spaceAbove > spaceBelow;
    const maxHeight = Math.min(
      openAbove ? spaceAbove : spaceBelow,
      window.innerHeight * PANEL_MAX_HEIGHT_RATIO
    );
    setPanelStyle(
      openAbove
        ? {
            position: 'fixed' as const,
            bottom: window.innerHeight - btn.top + SETTINGS_PANEL_GAP,
            left,
            maxHeight,
            overflowY: 'auto' as const,
          }
        : {
            position: 'fixed' as const,
            top: btn.bottom + SETTINGS_PANEL_GAP,
            left,
            maxHeight,
            overflowY: 'auto' as const,
          }
    );
  }, [nested, open]);

  const close = () => {
    setOpen(false);
    setPanel('main');
  };

  const speedLabel = state.playbackRate === 1 ? 'Normal' : `${state.playbackRate}x`;
  const qualityLabel =
    state.currentLevel === -1 ? 'Auto' : `${state.levels[state.currentLevel]?.height ?? '?'}p`;

  const rowClass =
    'w-full flex items-center justify-between gap-3 px-3 py-2 text-sm text-white hover:bg-white/10 transition-colors';
  const submenuRowClass =
    'w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-white hover:bg-white/10 transition-colors';

  const panelBody = (
    <>
          {panel === 'main' && (
            <div className="py-1">
              <div className={rowClass}>
                <span className="flex items-center gap-2">
                  <PlayCircle className="w-4 h-4 text-zinc-400 shrink-0" />
                  Autoplay
                </span>
                <Switch checked={autoPlay} onChange={setAutoPlay} />
              </div>
              <div className={rowClass}>
                <span className="flex items-center gap-2">
                  <Repeat className="w-4 h-4 text-zinc-400 shrink-0" />
                  Loop
                </span>
                <Switch checked={loop} onChange={setLoop} />
              </div>
              <div className={rowClass}>
                <span className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-zinc-400 shrink-0" />
                  Stable Volume
                </span>
                <Switch checked={stableVolume} onChange={setStableVolume} />
              </div>
              <div className={rowClass}>
                <span className="flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-zinc-400 shrink-0" />
                  Ambient mode
                </span>
                <Switch checked={ambientMode} onChange={setAmbientMode} />
              </div>
              <button
                onClick={() => setPanel('sleep')}
                className={submenuRowClass}
              >
                <span className="flex items-center gap-2">
                  <Moon className="w-4 h-4 text-zinc-400 shrink-0" />
                  Sleep timer
                </span>
                <span className="flex items-center gap-1 text-zinc-400 text-xs">
                  {sleepTimer}
                  <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                </span>
              </button>
              <button onClick={() => setPanel('speed')} className={submenuRowClass}>
                <span className="flex items-center gap-2">
                  <Gauge className="w-4 h-4 text-zinc-400 shrink-0" />
                  Playback speed
                </span>
                <span className="flex items-center gap-1 text-zinc-400 text-xs">
                  {speedLabel}
                  <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                </span>
              </button>
              {state.levels.length > 1 && (
                <button
                  onClick={() => setPanel('quality')}
                  className={submenuRowClass}
                >
                  <span className="flex items-center gap-2">
                    <Signal className="w-4 h-4 text-zinc-400 shrink-0" />
                    Quality
                  </span>
                  <span className="flex items-center gap-1 text-zinc-400 text-xs">
                    {qualityLabel}
                    <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                  </span>
                </button>
              )}
            </div>
          )}

          {panel === 'speed' && (
            <div className="py-1">
              <button
                onClick={() => setPanel('main')}
                className="w-full text-left px-3 py-2 text-sm text-zinc-400 hover:bg-white/10 border-b border-white/10 transition-colors"
              >
                ← Playback speed
              </button>
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setPlaybackRate(s);
                    close();
                  }}
                  className={cn(
                    'w-full text-left px-3 py-1.5 text-sm hover:bg-white/10 transition-colors',
                    state.playbackRate === s ? 'text-primary font-medium' : 'text-white'
                  )}
                >
                  {s === 1 ? 'Normal' : `${s}x`}
                </button>
              ))}
            </div>
          )}

          {panel === 'quality' && (
            <div className="py-1">
              <button
                onClick={() => setPanel('main')}
                className="w-full text-left px-3 py-2 text-sm text-zinc-400 hover:bg-white/10 border-b border-white/10 transition-colors"
              >
                ← Quality
              </button>
              <button
                onClick={() => {
                  setQualityLevel(-1);
                  close();
                }}
                className={cn(
                  'w-full text-left px-3 py-1.5 text-sm hover:bg-white/10 transition-colors',
                  state.currentLevel === -1 ? 'text-primary font-medium' : 'text-white'
                )}
              >
                Auto
              </button>
              {[...state.levels]
                .map((l, i) => ({ ...l, i }))
                .sort((a, b) => b.height - a.height)
                .map(({ height, i }) => (
                  <button
                    key={`${height}-${i}`}
                    onClick={() => {
                      setQualityLevel(i);
                      close();
                    }}
                    className={cn(
                      'w-full text-left px-3 py-1.5 text-sm hover:bg-white/10 transition-colors',
                      state.currentLevel === i ? 'text-primary font-medium' : 'text-white'
                    )}
                  >
                    {height}p
                  </button>
                ))}
            </div>
          )}

          {panel === 'sleep' && (
            <div className="py-1">
              <button
                onClick={() => setPanel('main')}
                className="w-full text-left px-3 py-2 text-sm text-zinc-400 hover:bg-white/10 border-b border-white/10 transition-colors"
              >
                ← Sleep timer
              </button>
              {SLEEP_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  onClick={() => {
                    setSleepTimer(opt);
                    close();
                  }}
                  className={cn(
                    'w-full text-left px-3 py-1.5 text-sm hover:bg-white/10 transition-colors',
                    sleepTimer === opt ? 'text-primary font-medium' : 'text-white'
                  )}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
    </>
  );

  const panelWrapperClass =
    'min-w-[240px] max-h-[70vh] overflow-y-auto bg-zinc-900/95 rounded-xl shadow-xl border border-white/10 backdrop-blur-md';
  const panelWrapperClassNested =
    'min-w-[200px] max-h-[60vh] overflow-y-auto border-t border-white/10 mt-0.5';

  if (nested) {
    return (
      <div className="relative w-full" ref={menuRef}>
        <button
          type="button"
          onClick={() => {
            setOpen((o) => !o);
            setPanel('main');
          }}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-white hover:bg-white/10 transition-colors rounded"
          aria-label="Settings"
          aria-expanded={open}
        >
          <span className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-zinc-400 shrink-0" />
            Settings
          </span>
          <ChevronRight
            className={cn('w-4 h-4 shrink-0 transition-transform', open && 'rotate-90')}
          />
        </button>
        {open && (
          <div
            ref={panelElRef as React.RefObject<HTMLDivElement>}
            className={panelWrapperClassNested}
          >
            {panelBody}
          </div>
        )}
      </div>
    );
  }

  const panelContent = (
    <div
      ref={(el) => {
        (panelElRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        if (panelRef)
          (panelRef as React.MutableRefObject<HTMLDivElement | null>).current = el ?? null;
      }}
      className={cn(panelWrapperClass, 'z-[100000100]')}
      style={panelStyle}
    >
      {panelBody}
    </div>
  );

  return (
    <div className="relative" ref={menuRef}>
      <button
        ref={triggerRef}
        onClick={() => {
          setOpen((o) => {
            const next = !o;
            if (next) onOpenChange?.(true);
            return next;
          });
          setPanel('main');
        }}
        className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-white"
        aria-label="Settings"
      >
        <Settings
          className={cn('w-5 h-5 transition-transform duration-300', open && 'rotate-45')}
        />
      </button>
      {open && typeof document !== 'undefined' && createPortal(panelContent, document.body)}
    </div>
  );
}