import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Play, Pause, SkipForward, MoreVertical } from 'lucide-react';
import { usePlayerContext } from '../PlayerContext';
import { useControlBarWidth } from '../hooks/useControlBarWidth';
import SeekBar from './seek/SeekBar';
import VolumeControl from './volume/VolumeControl';
import SettingsMenu from './settings/SettingsMenu';
import TheaterButton from './theater/TheaterButton';
import FullscreenButton from './fullscreen/FullscreenButton';
import CastButton from './cast/CastButton';
import SubtitleButton from './subtitles/SubtitleButton';
import MiniPlayerButton from './miniplayer/MiniPlayerButton';
import { formatTime } from './seek/functions/formatTime';
import type { HideControls } from '../types';

const isHidden = (hide?: HideControls, key?: keyof NonNullable<HideControls>) =>
  !!(hide && key && hide[key]);

const DROPDOWN_GAP = 8;
const VIEWPORT_PADDING = 16;
/** Prefer opening above when space below is less than this (keeps dropdown on screen). */
const MIN_SPACE_BELOW_TO_OPEN_DOWN = 320;
const DROPDOWN_MAX_HEIGHT_RATIO = 0.55;

interface ControlBarProps {
  onNext?: () => void;
  theaterMode?: boolean;
  onTheaterModeChange?: (active: boolean) => void;
  onPlayPauseClick?: () => void;
  hideControls?: HideControls;
}

export default function ControlBar({ onNext, theaterMode = false, onTheaterModeChange, onPlayPauseClick, hideControls }: ControlBarProps) {
  const { state, togglePlay } = usePlayerContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const { showTime, showRightInline, showVolumeSlider } = useControlBarWidth(containerRef);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    maxHeight?: number;
  }>({ left: 0 });

  useEffect(() => {
    if (!overflowOpen || !moreButtonRef.current) return;
    const btn = moreButtonRef.current.getBoundingClientRect();
    const dropdownWidth = 280;
    const padding = VIEWPORT_PADDING;
    let left = btn.right - dropdownWidth;
    left = Math.max(padding, Math.min(left, window.innerWidth - dropdownWidth - padding));
    const spaceBelow = window.innerHeight - btn.bottom - DROPDOWN_GAP - padding;
    const spaceAbove = btn.top - DROPDOWN_GAP - padding;
    const openAbove = spaceBelow < MIN_SPACE_BELOW_TO_OPEN_DOWN || spaceAbove > spaceBelow;
    const maxHeight = Math.min(
      openAbove ? spaceAbove : spaceBelow,
      window.innerHeight * DROPDOWN_MAX_HEIGHT_RATIO
    );
    setDropdownStyle(
      openAbove
        ? { bottom: window.innerHeight - btn.top + DROPDOWN_GAP, left, maxHeight }
        : { top: btn.bottom + DROPDOWN_GAP, left, maxHeight }
    );
  }, [overflowOpen]);

  useEffect(() => {
    if (!overflowOpen) return;
    const handle = (e: MouseEvent) => {
      const target = e.target as Node;
      const inOverflow = overflowRef.current?.contains(target);
      const inMoreBtn = moreButtonRef.current?.contains(target);
      if (!inOverflow && !inMoreBtn) setOverflowOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [overflowOpen]);

  const barBg = 'bg-black/50 backdrop-blur-sm rounded-2xl';

  return (
    <div ref={containerRef} className="absolute bottom-0 left-0 right-0 z-30 flex flex-col">
      <div className="flex items-center justify-between gap-3 px-3 pt-1 pb-1 min-w-0">
        {/* Left group: same transparent background as waveform */}
        <div className={`flex items-center gap-1 min-w-0 shrink-0 ${barBg} px-2.5 py-1.5`}>
          {!isHidden(hideControls, 'playPause') && (
            <button
              onClick={() => {
                togglePlay();
                onPlayPauseClick?.();
              }}
              className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-white shrink-0"
              aria-label={state.isPlaying ? 'Pause' : 'Play'}
            >
              {state.isPlaying ? (
                <Pause className="w-5 h-5 fill-white" />
              ) : (
                <Play className="w-5 h-5 fill-white" />
              )}
            </button>
          )}

          {!isHidden(hideControls, 'next') && onNext && (
            <button
              onClick={onNext}
              className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-white shrink-0"
              aria-label="Next"
            >
              <SkipForward className="w-5 h-5 fill-white" />
            </button>
          )}

          {!isHidden(hideControls, 'volume') && (
            <VolumeControl showSlider={showVolumeSlider} />
          )}

          {!isHidden(hideControls, 'time') && showTime && (
            <span className="text-white/90 text-xs font-medium ml-1 select-none tabular-nums shrink-0">
              {formatTime(state.currentTime)}
              <span className="text-white/40 mx-1">/</span>
              {formatTime(state.duration)}
            </span>
          )}
        </div>

        {/* Right group: fullscreen always visible; theater + settings inline or in dropdown */}
        <div className={`flex items-center gap-1 shrink-0 ${barBg} px-2 py-1.5`} ref={overflowRef}>
          {!isHidden(hideControls, 'subtitles') && <SubtitleButton />}
          {!isHidden(hideControls, 'miniPlayer') && <MiniPlayerButton />}
          {!isHidden(hideControls, 'cast') && <CastButton />}
          {!isHidden(hideControls, 'fullscreen') && <FullscreenButton />}
          {showRightInline ? (
            <>
              {!isHidden(hideControls, 'settings') && <SettingsMenu />}
              {!isHidden(hideControls, 'theater') && onTheaterModeChange && (
                <TheaterButton theaterMode={theaterMode} onTheaterModeChange={onTheaterModeChange} />
              )}
            </>
          ) : (
            <>
              {(!isHidden(hideControls, 'settings') || !isHidden(hideControls, 'theater')) && (
                <button
                  ref={moreButtonRef}
                  onClick={() => setOverflowOpen((o) => !o)}
                  className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-white"
                  aria-label="More controls"
                >
                  <MoreVertical className="w-5 h-5" />
                </button>
              )}
              {overflowOpen &&
                typeof document !== 'undefined' &&
                createPortal(
                  <div
                    ref={overflowRef}
                    className="fixed py-1 min-w-[200px] max-w-[280px] rounded-xl bg-zinc-900/95 border border-white/10 shadow-xl backdrop-blur-md z-[100000100] flex flex-col overflow-y-auto"
                    style={{
                      position: 'fixed',
                      left: dropdownStyle.left,
                      ...(dropdownStyle.top != null ? { top: dropdownStyle.top } : { bottom: dropdownStyle.bottom }),
                      maxHeight: dropdownStyle.maxHeight,
                    }}
                  >
                    {!isHidden(hideControls, 'settings') && <SettingsMenu nested />}
                    {!isHidden(hideControls, 'theater') && onTheaterModeChange && (
                      <div className="px-2 py-1" onClick={() => setOverflowOpen(false)}>
                        <TheaterButton theaterMode={theaterMode} onTheaterModeChange={onTheaterModeChange} />
                      </div>
                    )}
                  </div>,
                  document.body
                )}
            </>
          )}
        </div>
      </div>

      {!isHidden(hideControls, 'seek') && (
        <div className="px-3 pb-2 pt-0">
          <SeekBar />
        </div>
      )}
    </div>
  );
}
