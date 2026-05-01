import { useState, type RefObject } from 'react';
import { Link } from 'react-router';
import { isMobile } from 'react-device-detect';
import {
  Settings,
  BarChart3,
  Monitor,
  Moon,
  Gauge,
  Signal,
  PlayCircle,
  Repeat,
  AudioWaveform,
  Waves,
  Braces,
  Headphones,
} from 'lucide-react';
import { usePlayerContext } from '../../PlayerContext';
import { isSpatialAudioUiSupported } from '../../hooks/useSpatialAudio';
import { cn } from '~/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';
import {
  AUDIO_VISUALIZER_STYLES,
  AUDIO_VISUALIZER_STYLE_LABELS,
  type AudioVisualizerStyle,
} from '../../audioVisualizerStyles';

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const SLEEP_OPTIONS = ['Off', '5 min', '10 min', '15 min', '30 min', '45 min', '1 hour', 'End of video'];

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
        'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200',
        checked ? 'bg-primary' : 'bg-secondary',
        disabled && 'cursor-not-allowed opacity-50'
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

function SettingsMenuBody() {
  const subMenuWidth = cn(
    'max-h-[min(50dvh,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto overscroll-contain',
    isMobile ? 'min-w-0 w-[min(18rem,calc(100vw-2rem))]' : 'min-w-[200px]',
  );
  const {
    state,
    setPlaybackRate,
    setQualityLevel,
    ambientMode,
    setAmbientMode,
    autoPlay,
    setAutoPlay,
    loop,
    setLoop,
    stableVolume,
    setStableVolume,
    audioVisualizer,
    setAudioVisualizer,
    audioVisualizerStyle,
    setAudioVisualizerStyle,
    statsForNerds,
    setStatsForNerds,
    spatialAudio,
    setSpatialAudio,
    setSpatialAudioDialogOpen,
    authPlaybackFeatures,
  } = usePlayerContext();
  const [sleepTimer, setSleepTimer] = useState('Off');
  const auth = authPlaybackFeatures;

  const speedLabel = state.playbackRate === 1 ? 'Normal' : `${state.playbackRate}x`;
  const qualityLabel =
    state.currentLevel === -1 ? 'Auto' : `${state.levels[state.currentLevel]?.height ?? '?'}p`;

  const toggleRowClass =
    'flex w-full min-w-0 cursor-default items-center justify-between gap-3 rounded-lg py-0.5';

  return (
    <>
      {!auth && (
        <div className="mx-1 mb-2 rounded-md border border-border/60 bg-muted/40 px-2.5 py-2 text-xs leading-snug text-muted-foreground sm:mx-2 sm:px-3">
          <Link to="/auth/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>{' '}
          to use autoplay (up next), ambient mode, and the audio visualizer.
        </div>
      )}
      <DropdownMenuGroup>
        <DropdownMenuLabel>Playback</DropdownMenuLabel>
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
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuLabel>Display</DropdownMenuLabel>
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
              Sign in to enable ambient lighting around the player.
            </TooltipContent>
          )}
        </Tooltip>
        {!isMobile && (
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
        {isSpatialAudioUiSupported() && (
          <DropdownMenuItem
            onSelect={() => setSpatialAudioDialogOpen(true)}
            className={toggleRowClass}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <Headphones className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">8D / Spatial audio</span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {spatialAudio.enabled ? 'On' : 'Off'}
            </span>
          </DropdownMenuItem>
        )}
      </DropdownMenuGroup>

      {!isMobile && audioVisualizer && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Visualizer</DropdownMenuLabel>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="w-full min-w-0 gap-2 pr-1">
                <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                  <Waves className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">Style</span>
                </span>
                <span className="shrink-0 pl-1 text-right text-xs font-normal tabular-nums text-muted-foreground">
                  {AUDIO_VISUALIZER_STYLE_LABELS[audioVisualizerStyle]}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className={subMenuWidth} collisionPadding={12}>
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
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuGroup>
        </>
      )}

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuLabel>Timers and media</DropdownMenuLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="w-full min-w-0 gap-2 pr-1">
            <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              <Moon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">Sleep timer</span>
            </span>
            <span className="shrink-0 pl-1 text-right text-xs font-normal tabular-nums text-muted-foreground">
              {sleepTimer}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={cn(subMenuWidth, 'min-w-[180px]')} collisionPadding={12}>
            {SLEEP_OPTIONS.map((opt) => (
              <DropdownMenuItem
                key={opt}
                onClick={() => setSleepTimer(opt)}
                className={cn(sleepTimer === opt ? 'font-medium text-primary' : undefined)}
              >
                {opt}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="w-full min-w-0 gap-2 pr-1">
            <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              <Gauge className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">Playback speed</span>
            </span>
            <span className="shrink-0 pl-1 text-right text-xs font-normal tabular-nums text-muted-foreground">
              {speedLabel}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={cn(subMenuWidth, 'min-w-[160px]')} collisionPadding={12}>
            {SPEEDS.map((s) => (
              <DropdownMenuItem
                key={s}
                onClick={() => setPlaybackRate(s)}
                className={cn(state.playbackRate === s ? 'font-medium text-primary' : undefined)}
              >
                {s === 1 ? 'Normal' : `${s}x`}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {state.levels.length > 1 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="w-full min-w-0 gap-2 pr-1">
              <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                <Signal className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">Quality</span>
              </span>
              <span className="shrink-0 pl-1 text-right text-xs font-normal tabular-nums text-muted-foreground">
                {qualityLabel}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className={cn(subMenuWidth, 'min-w-[160px]')} collisionPadding={12}>
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
            </DropdownMenuSubContent>
          </DropdownMenuSub>
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

export default function SettingsMenu({ nested, panelRef, onOpenChange, overlayTrigger, pillBarTrigger }: SettingsMenuProps) {
  const menuWidthClass = cn(
    'max-h-[min(72dvh,var(--radix-dropdown-menu-content-available-height))]',
    isMobile ? 'min-w-0 w-[calc(100vw-1.25rem)]' : 'min-w-[260px] max-w-[min(320px,calc(100vw-2rem))]',
  );

  // The spatial-audio dialog itself is rendered once at the player root (HLSPlayer);
  // here we only need the trigger button + menu body. Mounting it again at every
  // SettingsMenu instance would cause duplicate dialogs and animation jank.
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
                  <Settings className="h-4 w-4 shrink-0 text-muted-foreground" />
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
              className={
                overlayTrigger
                  ? 'flex h-9 w-9 items-center justify-center rounded-lg border border-white/20 bg-black/50 text-white shadow-sm backdrop-blur-sm outline-none hover:bg-black/60 data-[state=open]:bg-black/60 data-[state=open]:[&_svg]:rotate-45'
                  : pillBarTrigger
                    ? 'rounded-lg p-2 text-white outline-none transition-colors hover:bg-white/10 data-[state=open]:bg-white/15 data-[state=open]:[&_svg]:rotate-45'
                    : 'rounded-md p-1.5 text-foreground transition-colors hover:bg-accent data-[state=open]:[&_svg]:rotate-45'
              }
              aria-label="Settings"
            >
              <Settings
                className={
                  overlayTrigger || pillBarTrigger
                    ? 'h-5 w-5 text-white transition-transform duration-300'
                    : 'h-5 w-5 transition-transform duration-300'
                }
              />
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
