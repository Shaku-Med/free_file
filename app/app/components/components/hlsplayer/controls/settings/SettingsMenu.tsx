import { useState, type RefObject } from 'react';
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
} from 'lucide-react';
import { usePlayerContext } from '../../PlayerContext';
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
import {
  AUDIO_VISUALIZER_STYLES,
  AUDIO_VISUALIZER_STYLE_LABELS,
  type AudioVisualizerStyle,
} from '../../audioVisualizerStyles';

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const SLEEP_OPTIONS = ['Off', '5 min', '10 min', '15 min', '30 min', '45 min', '1 hour', 'End of video'];

const menuWidthClass = 'min-w-[260px]';
const subMenuWidth = 'min-w-[200px]';

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
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
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

function SettingsMenuBody() {
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
  } = usePlayerContext();
  const [sleepTimer, setSleepTimer] = useState('Off');

  const speedLabel = state.playbackRate === 1 ? 'Normal' : `${state.playbackRate}x`;
  const qualityLabel =
    state.currentLevel === -1 ? 'Auto' : `${state.levels[state.currentLevel]?.height ?? '?'}p`;

  const toggleRowClass = 'flex cursor-default items-center justify-between gap-4 rounded-lg';

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel>Playback</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(e) => e.preventDefault()}
          className={toggleRowClass}
        >
          <span className="flex items-center gap-2">
            <PlayCircle className="text-muted-foreground" />
            Autoplay
          </span>
          <Switch checked={autoPlay} onChange={setAutoPlay} />
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => e.preventDefault()}
          className={toggleRowClass}
        >
          <span className="flex items-center gap-2">
            <Repeat className="text-muted-foreground" />
            Loop
          </span>
          <Switch checked={loop} onChange={setLoop} />
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => e.preventDefault()}
          className={toggleRowClass}
        >
          <span className="flex items-center gap-2">
            <BarChart3 className="text-muted-foreground" />
            Stable volume
          </span>
          <Switch checked={stableVolume} onChange={setStableVolume} />
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuLabel>Display</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(e) => e.preventDefault()}
          className={toggleRowClass}
        >
          <span className="flex items-center gap-2">
            <Monitor className="text-muted-foreground" />
            Ambient mode
          </span>
          <Switch checked={ambientMode} onChange={setAmbientMode} />
        </DropdownMenuItem>
        {!isMobile && (
          <DropdownMenuItem
            onSelect={(e) => e.preventDefault()}
            className={toggleRowClass}
          >
            <span className="flex items-center gap-2">
              <AudioWaveform className="text-muted-foreground" />
              Audio visualizer
            </span>
            <Switch checked={audioVisualizer} onChange={setAudioVisualizer} />
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onSelect={(e) => e.preventDefault()}
          className={toggleRowClass}
        >
          <span className="flex items-center gap-2">
            <Braces className="text-muted-foreground" />
            Stats for nerds
          </span>
          <Switch checked={statsForNerds} onChange={setStatsForNerds} />
        </DropdownMenuItem>
      </DropdownMenuGroup>

      {!isMobile && audioVisualizer && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Visualizer</DropdownMenuLabel>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2">
                <Waves className="text-muted-foreground" />
                Style
                <span className="ml-auto text-xs font-normal text-muted-foreground">
                  {AUDIO_VISUALIZER_STYLE_LABELS[audioVisualizerStyle]}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className={subMenuWidth}>
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
          <DropdownMenuSubTrigger className="gap-2">
            <Moon className="text-muted-foreground" />
            Sleep timer
            <span className="ml-auto text-xs font-normal text-muted-foreground">{sleepTimer}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[180px]">
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
          <DropdownMenuSubTrigger className="gap-2">
            <Gauge className="text-muted-foreground" />
            Playback speed
            <span className="ml-auto text-xs font-normal text-muted-foreground">{speedLabel}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[160px]">
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
            <DropdownMenuSubTrigger className="gap-2">
              <Signal className="text-muted-foreground" />
              Quality
              <span className="ml-auto text-xs font-normal text-muted-foreground">{qualityLabel}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[160px]">
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
  /** Inside overflow “More” panel: non-modal so nested menus work. */
  nested?: boolean;
  panelRef?: RefObject<HTMLDivElement | null>;
  onOpenChange?: (open: boolean) => void;
}

export default function SettingsMenu({ nested, panelRef, onOpenChange }: SettingsMenuProps) {
  if (nested) {
    return (
      <DropdownMenu modal={false}>
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
        <DropdownMenuContent
          ref={panelRef}
          side="right"
          align="start"
          sideOffset={10}
          className={menuWidthClass}
        >
          <SettingsMenuBody />
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded-md p-1.5 text-foreground transition-colors hover:bg-accent data-[state=open]:[&_svg]:rotate-45"
          aria-label="Settings"
        >
          <Settings className="h-5 w-5 transition-transform duration-300" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={panelRef}
        side="top"
        align="end"
        sideOffset={8}
        className={menuWidthClass}
      >
        <SettingsMenuBody />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
