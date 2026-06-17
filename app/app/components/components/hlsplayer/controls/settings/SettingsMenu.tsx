import { useEffect, useState, type RefObject } from 'react';
import { Link } from 'react-router';
import { useAuthHrefs } from '~/lib/loginRedirect';
import { isMobile } from 'react-device-detect';
import {
  Settings,
  BarChart3,
  Monitor,
  Square,
  Moon,
  Gauge,
  Signal,
  PlayCircle,
  Repeat,
  AudioWaveform,
  Braces,
  Headphones,
  PartyPopper,
  Activity,
  Orbit,
  Speaker,
} from 'lucide-react';
import { usePlayerContext, SLEEP_TIMER_OPTIONS } from '../../PlayerContext';
import { isSpatialAudioUiSupported } from '../../hooks/useSpatialAudio';
import { cn } from '~/lib/utils';
import { mobileOverlayIcon, mobileOverlayCircleBtn } from '../mobileControlMetrics';
import {
  DropdownMenu,
  DropdownMenuCollapsible,
  DropdownMenuCollapsibleContent,
  DropdownMenuCollapsibleTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';
import { STEM_TYPES } from '../../audioStems';
import {
  buildStemConfettiThemePalettes,
  STEM_CONFETTI_META,
  stemConfettiSwatchColor,
  type StemConfettiThemePalettes,
} from '../../stemConfettiSettings';

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) return;
        onChange(!checked);
      }}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover',
        checked ? 'bg-primary' : 'bg-muted-foreground/25',
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block size-3.5 rounded-full bg-white shadow-sm ring-1 ring-black/10 transition-transform duration-200 ease-out',
          checked ? 'translate-x-[18px]' : 'translate-x-1'
        )}
      />
    </button>
  );
}

export function SettingsMenuBody() {
  const { loginHref } = useAuthHrefs();
  const {
    state,
    setPlaybackRate,
    setQualityLevel,
    ambientMode,
    setAmbientMode,
    ambientSync,
    setAmbientSync,
    ambientSize,
    setAmbientSize,
    playerBackground,
    setPlayerBackground,
    autoPlay,
    setAutoPlay,
    loop,
    setLoop,
    stableVolume,
    setStableVolume,
    audioVisualizer,
    setAudioVisualizer,
    visualizerConfetti,
    setVisualizerConfetti,
    videoBounce,
    setVideoBounce,
    videoBounceIntensity,
    setVideoBounceIntensity,
    videoBounceInstruments,
    setVideoBounceInstrument,
    audioStemsAvailable,
    stemConfettiInstruments,
    setStemConfettiInstrument,
    statsForNerds,
    setStatsForNerds,
    vrTheater,
    setVrTheater,
    vrSoundSystem,
    setVrSoundSystem,
    vrImmersive,
    setVrImmersive,
    sleepTimer,
    setSleepTimer,
    sleepTimerEndsAt,
    spatialAudio,
    setSpatialAudio,
    setSpatialAudioDialogOpen,
    authPlaybackFeatures,
    isReel,
  } = usePlayerContext();
  const auth = authPlaybackFeatures;

  const [stemPalettes, setStemPalettes] = useState<StemConfettiThemePalettes>(() =>
    buildStemConfettiThemePalettes(),
  );
  useEffect(() => {
    const sync = () => setStemPalettes(buildStemConfettiThemePalettes());
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);

  const speedLabel = state.playbackRate === 1 ? 'Normal' : `${state.playbackRate}x`;
  const qualityLabel =
    state.currentLevel === -1 ? 'Auto' : `${state.levels[state.currentLevel]?.height ?? '?'}p`;

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (sleepTimerEndsAt == null) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [sleepTimerEndsAt]);
  const sleepLabel = (() => {
    if (sleepTimerEndsAt == null) return sleepTimer;
    const remaining = Math.max(0, sleepTimerEndsAt - nowMs);
    const totalSec = Math.ceil(remaining / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  })();

  const toggleRowClass =
    'flex w-full min-w-0 cursor-default items-center justify-between gap-3 rounded-lg py-1';

  /** Tiny uppercase section headers  reads like one settings card per group. */
  const sectionLabelClass =
    'px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70';

  /** Right-side current-value chips (speed, quality, sleep, size, etc). */
  const valueChipClass =
    'shrink-0 rounded-full bg-muted/70 px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground';

  return (
    <>
      {!auth && (
        <div className="mx-1 mb-2 rounded-lg bg-primary/10 px-2.5 py-2 text-xs leading-snug text-muted-foreground sm:mx-2 sm:px-3">
          <Link to={loginHref} className="font-semibold text-primary hover:underline">
            Sign in
          </Link>{' '}
          to use autoplay (up next), ambient mode, and the audio visualizer.
        </div>
      )}
      <DropdownMenuGroup>
        <DropdownMenuLabel className={sectionLabelClass}>Playback</DropdownMenuLabel>
        {/* Autoplay = "up next", which reels don't have (the swiper handles it). */}
        {!isReel && (
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuItem
                onSelect={(e) => e.preventDefault()}
                className={cn(toggleRowClass, !auth && 'opacity-60')}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <PlayCircle className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">Autoplay</span>
                </span>
                <Switch checked={autoPlay} onChange={setAutoPlay} disabled={!auth} />
              </DropdownMenuItem>
            </TooltipTrigger>
            {!auth && (
              <TooltipContent side={isMobile ? 'top' : 'left'} className="max-w-[220px]">
                Sign in to enable automatic playback of the next video.
              </TooltipContent>
            )}
          </Tooltip>
        )}
        <DropdownMenuItem
          onSelect={(e) => e.preventDefault()}
          className={toggleRowClass}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <Repeat className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">Loop</span>
          </span>
          <Switch checked={loop} onChange={setLoop} />
        </DropdownMenuItem>
        {!isReel && (
          <DropdownMenuItem
            onSelect={(e) => e.preventDefault()}
            className={toggleRowClass}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <BarChart3 className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">Stable volume</span>
            </span>
            <Switch checked={stableVolume} onChange={setStableVolume} />
          </DropdownMenuItem>
        )}
      </DropdownMenuGroup>

      <DropdownMenuSeparator className="my-1.5 bg-border/50" />

      <DropdownMenuGroup>
        <DropdownMenuLabel className={sectionLabelClass}>Display</DropdownMenuLabel>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuItem
              onSelect={(e) => e.preventDefault()}
              className={cn(toggleRowClass, !auth && 'opacity-60')}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <Monitor className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">Ambient mode</span>
              </span>
              <Switch checked={ambientMode} onChange={setAmbientMode} disabled={!auth} />
            </DropdownMenuItem>
          </TooltipTrigger>
          {!auth && (
            <TooltipContent side={isMobile ? 'top' : 'left'} className="max-w-[220px]">
              Sign in to enable ambient lighting behind the watch page.
            </TooltipContent>
          )}
        </Tooltip>
        {ambientMode && auth && (
          <>
            <DropdownMenuItem
              onSelect={(e) => e.preventDefault()}
              className={cn(toggleRowClass, 'pl-7')}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <Activity className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">Ambient sync</span>
              </span>
              <Switch checked={ambientSync} onChange={setAmbientSync} />
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                // Cycle 1x â†’ 1.25x â†’ 1.5x â†’ 2x â†’ 1x.
                const steps = [1, 1.25, 1.5, 2];
                const idx = steps.findIndex((s) => Math.abs(s - ambientSize) < 0.01);
                setAmbientSize(steps[(idx + 1) % steps.length]);
              }}
              className={cn(toggleRowClass, 'cursor-pointer pl-7')}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <Monitor className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">Ambient size</span>
              </span>
              <span className={valueChipClass}>{ambientSize}x</span>
            </DropdownMenuItem>
          </>
        )}
        {/* Reels intentionally have no player background, so the toggle is moot. */}
        {!isReel && (
          <DropdownMenuItem
            onSelect={(e) => e.preventDefault()}
            className={toggleRowClass}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <Square className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">Player background</span>
            </span>
            <Switch checked={playerBackground} onChange={setPlayerBackground} />
          </DropdownMenuItem>
        )}
        {!isReel && (
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuItem
                onSelect={(e) => e.preventDefault()}
                className={cn(toggleRowClass, !auth && 'opacity-60')}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <Orbit className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">VR theater</span>
                </span>
                <Switch checked={vrTheater} onChange={setVrTheater} disabled={!auth} />
              </DropdownMenuItem>
            </TooltipTrigger>
            {!auth && (
              <TooltipContent side={isMobile ? 'top' : 'left'} className="max-w-[220px]">
                Sign in to watch inside the 3D theater room.
              </TooltipContent>
            )}
          </Tooltip>
        )}
        {!isReel && vrTheater && (
          <DropdownMenuItem
            onSelect={(e) => e.preventDefault()}
            className={cn(toggleRowClass, 'pl-7')}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <Speaker className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">Sound system</span>
            </span>
            <Switch checked={vrSoundSystem} onChange={setVrSoundSystem} disabled={!auth} />
          </DropdownMenuItem>
        )}
        {!isReel && vrTheater && (
          <DropdownMenuItem
            onSelect={(e) => e.preventDefault()}
            className={cn(toggleRowClass, 'pl-7')}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <Orbit className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">Immersive</span>
            </span>
            <Switch checked={vrImmersive} onChange={setVrImmersive} disabled={!auth} />
          </DropdownMenuItem>
        )}
        {!isReel && audioStemsAvailable && (
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuItem
                onSelect={(e) => e.preventDefault()}
                className={cn(toggleRowClass, !auth && 'opacity-60')}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <AudioWaveform className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">Audio visualizer</span>
                </span>
                <Switch
                  checked={audioVisualizer}
                  onChange={setAudioVisualizer}
                  disabled={!auth}
                />
              </DropdownMenuItem>
            </TooltipTrigger>
            {!auth && (
              <TooltipContent side={isMobile ? 'top' : 'left'} className="max-w-[220px]">
                Sign in to use the audio visualizer.
              </TooltipContent>
            )}
          </Tooltip>
        )}
        <DropdownMenuItem
          onSelect={(e) => e.preventDefault()}
          className={toggleRowClass}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <Braces className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">Stats for nerds</span>
          </span>
          <Switch checked={statsForNerds} onChange={setStatsForNerds} />
        </DropdownMenuItem>
        {!isReel && isSpatialAudioUiSupported() && (
          <DropdownMenuItem
            onSelect={() => setSpatialAudioDialogOpen(true)}
            className={toggleRowClass}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <Headphones className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">8D / Spatial audio</span>
            </span>
            <span
              className={cn(
                valueChipClass,
                spatialAudio.enabled && 'bg-primary/15 text-primary',
              )}
            >
              {spatialAudio.enabled ? 'On' : 'Off'}
            </span>
          </DropdownMenuItem>
        )}
      </DropdownMenuGroup>

      {!isReel && audioStemsAvailable && audioVisualizer && (
        <>
          <DropdownMenuSeparator className="my-1.5 bg-border/50" />
          <DropdownMenuGroup>
            <DropdownMenuLabel className={sectionLabelClass}>Visualizer</DropdownMenuLabel>
            {/*
              MIGHT NEED LATER - DO NOT TOUCH.
              Legacy canvas analyser style picker (bars / mirror / ribbon / pulse).
            <DropdownMenuCollapsible>
              <DropdownMenuCollapsibleTrigger className="w-full min-w-0 gap-2 pr-1">
                <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                  <Waves className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">Style</span>
                </span>
                <span className={cn(valueChipClass, 'ml-1')}>
                  {AUDIO_VISUALIZER_STYLE_LABELS[audioVisualizerStyle]}
                </span>
              </DropdownMenuCollapsibleTrigger>
              <DropdownMenuCollapsibleContent>
                <DropdownMenuRadioGroup
                  value={audioVisualizerStyle}
                  onValueChange={(v) =>
                    setAudioVisualizerStyle(v as AudioVisualizerStyle)
                  }
                >
                  {AUDIO_VISUALIZER_STYLES.map((id) => (
                    <DropdownMenuRadioItem key={id} value={id}>
                      {AUDIO_VISUALIZER_STYLE_LABELS[id]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuCollapsibleContent>
            </DropdownMenuCollapsible>
            */}
            <DropdownMenuItem
              onSelect={(e) => e.preventDefault()}
              className={cn(toggleRowClass, !auth && 'opacity-60')}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <PartyPopper className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">Border glow</span>
              </span>
              <Switch
                checked={visualizerConfetti}
                onChange={setVisualizerConfetti}
                disabled={!auth}
              />
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => e.preventDefault()}
              className={cn(toggleRowClass, !auth && 'opacity-60')}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <Activity className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">Video bounce</span>
              </span>
              <Switch
                checked={videoBounce}
                onChange={setVideoBounce}
                disabled={!auth}
              />
            </DropdownMenuItem>
            {videoBounce && audioStemsAvailable && auth && (
              <DropdownMenuCollapsible>
                <DropdownMenuCollapsibleTrigger className="w-full min-w-0 gap-2 pr-1">
                  <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                    <Activity className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate">Dance tuning</span>
                  </span>
                  <span className={cn(valueChipClass, 'ml-1')}>
                    {Math.round(videoBounceIntensity * 100)}%
                  </span>
                </DropdownMenuCollapsibleTrigger>
                <DropdownMenuCollapsibleContent>
                  {/* Intensity: how hard hits shove the bounce/shake/vibration */}
                  <DropdownMenuItem
                    onSelect={(e) => e.preventDefault()}
                    className="flex-col items-stretch gap-1.5"
                  >
                    <span className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Intensity</span>
                      <span className="tabular-nums">{Math.round(videoBounceIntensity * 100)}%</span>
                    </span>
                    <input
                      type="range"
                      min={25}
                      max={200}
                      step={5}
                      value={Math.round(videoBounceIntensity * 100)}
                      onChange={(e) => setVideoBounceIntensity(Number(e.target.value) / 100)}
                      onKeyDown={(e) => e.stopPropagation()}
                      className="w-full accent-primary"
                      aria-label="Video bounce intensity"
                    />
                  </DropdownMenuItem>
                  {/* What the bounce listens to */}
                  {STEM_TYPES.map((type) => {
                    const meta = STEM_CONFETTI_META[type];
                    const swatch = stemConfettiSwatchColor(type, stemPalettes);
                    return (
                      <DropdownMenuItem
                        key={type}
                        onSelect={(e) => e.preventDefault()}
                        className={toggleRowClass}
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          <span
                            className="size-3 shrink-0 rounded-full ring-1 ring-border/40"
                            style={{ backgroundColor: swatch }}
                            aria-hidden
                          />
                          <span className="min-w-0 truncate">{meta.label}</span>
                        </span>
                        <Switch
                          checked={videoBounceInstruments[type]}
                          onChange={(v) => setVideoBounceInstrument(type, v)}
                        />
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuCollapsibleContent>
              </DropdownMenuCollapsible>
            )}
          </DropdownMenuGroup>
        </>
      )}

      <DropdownMenuSeparator className="my-1.5 bg-border/50" />

      <DropdownMenuGroup>
        <DropdownMenuLabel className={sectionLabelClass}>
          {isReel ? 'Media' : 'Timers and media'}
        </DropdownMenuLabel>
        {!isReel && (
          <DropdownMenuCollapsible>
            <DropdownMenuCollapsibleTrigger className="w-full min-w-0 gap-2 pr-1">
              <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                <Moon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">Sleep timer</span>
              </span>
              <span className={cn(valueChipClass, 'ml-1')}>
                {sleepLabel}
              </span>
            </DropdownMenuCollapsibleTrigger>
            <DropdownMenuCollapsibleContent>
              {SLEEP_TIMER_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt}
                  onClick={() => setSleepTimer(opt)}
                  className={cn(sleepTimer === opt ? 'font-medium text-primary' : undefined)}
                >
                  {opt}
                </DropdownMenuItem>
              ))}
            </DropdownMenuCollapsibleContent>
          </DropdownMenuCollapsible>
        )}

        <DropdownMenuCollapsible>
          <DropdownMenuCollapsibleTrigger className="w-full min-w-0 gap-2 pr-1">
            <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              <Gauge className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">Playback speed</span>
            </span>
            <span className={cn(valueChipClass, 'ml-1')}>
              {speedLabel}
            </span>
          </DropdownMenuCollapsibleTrigger>
          <DropdownMenuCollapsibleContent>
            {SPEEDS.map((s) => (
              <DropdownMenuItem
                key={s}
                onClick={() => setPlaybackRate(s)}
                className={cn(state.playbackRate === s ? 'font-medium text-primary' : undefined)}
              >
                {s === 1 ? 'Normal' : `${s}x`}
              </DropdownMenuItem>
            ))}
          </DropdownMenuCollapsibleContent>
        </DropdownMenuCollapsible>

        {state.levels.length > 1 && (
          <DropdownMenuCollapsible>
            <DropdownMenuCollapsibleTrigger className="w-full min-w-0 gap-2 pr-1">
              <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                <Signal className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">Quality</span>
              </span>
              <span className={cn(valueChipClass, 'ml-1')}>
                {qualityLabel}
              </span>
            </DropdownMenuCollapsibleTrigger>
            <DropdownMenuCollapsibleContent>
              <DropdownMenuItem
                onClick={() => setQualityLevel(-1)}
                className={cn(state.currentLevel === -1 ? 'font-medium text-primary' : undefined)}
              >
                Auto
              </DropdownMenuItem>
              {[...state.levels]
                .map((l, i) => ({ ...l, i }))
                .sort((a, b) => b.height - a.height)
                .map(({ height, i }) => (
                  <DropdownMenuItem
                    key={`${height}-${i}`}
                    onClick={() => setQualityLevel(i)}
                    className={cn(state.currentLevel === i ? 'font-medium text-primary' : undefined)}
                  >
                    {height}p
                  </DropdownMenuItem>
                ))}
            </DropdownMenuCollapsibleContent>
          </DropdownMenuCollapsible>
        )}
      </DropdownMenuGroup>
    </>
  );
}

interface SettingsMenuProps {
  nested?: boolean;
  panelRef?: RefObject<HTMLDivElement | null>;
  onOpenChange?: (open: boolean) => void;
  overlayTrigger?: boolean;
  pillBarTrigger?: boolean;
}

function useResolutionBadge(): string | null {
  const { state } = usePlayerContext();
  const h =
    state.currentLevel >= 0 && state.levels[state.currentLevel]
      ? state.levels[state.currentLevel].height
      : null;
  if (h == null) return null;
  if (h >= 2160) return '4K';
  if (h >= 720) return 'HD';
  return null;
}

function QualityBadge({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        'absolute -right-1 -top-1 z-10 flex h-3.5 min-w-[1.1rem] items-center justify-center rounded px-0.5 text-[8px] font-bold uppercase leading-none tracking-wide shadow-sm',
        label === '4K'
          ? 'bg-amber-400 text-black'
          : 'bg-blue-500 text-white',
        className,
      )}
    >
      {label}
    </span>
  );
}

export default function SettingsMenu({ nested, panelRef, onOpenChange, overlayTrigger, pillBarTrigger }: SettingsMenuProps) {
  const menuWidthClass = cn(
    'max-h-[min(72dvh,var(--radix-dropdown-menu-content-available-height))]',
    isMobile ? 'min-w-0 w-[calc(100vw-1.25rem)]' : 'min-w-[260px] max-w-[min(320px,calc(100vw-2rem))]',
  );
  const badge = useResolutionBadge();

  if (nested) {
    return (
      <DropdownMenu modal={false}>
        <Tooltip delayDuration={350}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex w-full cursor-default items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-foreground outline-none hover:bg-accent focus-visible:bg-accent data-[state=open]:bg-accent"
                aria-label="Settings"
              >
                <span className="flex items-center gap-2">
                  <span className="relative shrink-0">
                    <Settings className="h-4 w-4 text-muted-foreground" />
                    {badge && <QualityBadge label={badge} className="-right-2 -top-2 h-3 text-[7px]" />}
                  </span>
                  Settings
                </span>
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">Playback settings</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          ref={panelRef}
          side={isMobile ? 'bottom' : 'right'}
          align="start"
          sideOffset={isMobile ? 8 : 10}
          collisionPadding={12}
          className={menuWidthClass}
        >
          <SettingsMenuBody />
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <Tooltip delayDuration={350}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(e) => {
                if (overlayTrigger || pillBarTrigger) e.stopPropagation();
              }}
              className={cn(
                'relative',
                overlayTrigger
                  ? cn(
                      mobileOverlayCircleBtn,
                      'outline-none hover:bg-black/90 data-[state=open]:bg-black/90 data-[state=open]:[&_svg]:rotate-45',
                    )
                  : pillBarTrigger
                    ? 'rounded-lg p-2 text-white outline-none transition-colors hover:bg-white/10 data-[state=open]:bg-white/15 data-[state=open]:[&_svg]:rotate-45'
                    : 'rounded-md p-1.5 text-foreground transition-colors hover:bg-accent data-[state=open]:[&_svg]:rotate-45',
              )}
              aria-label="Settings"
            >
              <Settings
                className={
                  overlayTrigger
                    ? cn(mobileOverlayIcon, 'text-white transition-transform duration-300')
                    : pillBarTrigger
                      ? 'h-5 w-5 text-white transition-transform duration-300'
                      : 'h-5 w-5 transition-transform duration-300'
                }
              />
              {badge && <QualityBadge label={badge} />}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">Playback settings</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        ref={panelRef}
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className={menuWidthClass}
      >
        <SettingsMenuBody />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
