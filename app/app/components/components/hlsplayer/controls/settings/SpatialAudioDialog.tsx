import { useCallback, useRef } from 'react';
import { Headphones, Sparkles, Radio } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Button } from '~/components/ui/button';
import { Label } from '~/components/ui/label';
import { Slider } from '~/components/ui/slider';
import { cn } from '~/lib/utils';
import {
  DEFAULT_SPATIAL_CONFIG,
  type SpatialAudioConfig,
  type SpatialAudioMode,
} from '../../hooks/useSpatialAudio';

interface SpatialAudioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: SpatialAudioConfig;
  onChange: (next: SpatialAudioConfig) => void;
}

interface Preset {
  id: string;
  label: string;
  description: string;
  /** Undefined fields fall back to current config. */
  patch: Partial<SpatialAudioConfig>;
}

const PRESETS: Preset[] = [
  {
    id: 'room-front',
    label: 'Room Speaker',
    description: 'Stable front speaker feel, like standing in front of monitors.',
    patch: { mode: 'room-front', radius: 1.2, speedHz: 0.25 },
  },
  {
    id: 'orbit',
    label: '8D Orbit',
    description: 'Sound circles around your head — the classic 8D effect.',
    patch: { mode: 'orbit-horizontal', radius: 1.5, speedHz: 0.25 },
  },
  {
    id: 'orbit-fast',
    label: 'Fast Orbit',
    description: 'Same orbit, twice as fast.',
    patch: { mode: 'orbit-horizontal', radius: 1.5, speedHz: 0.55 },
  },
  {
    id: 'tumble',
    label: 'Vertical Tumble',
    description: 'Above → behind → underfoot → in front → repeat.',
    patch: { mode: 'orbit-vertical', radius: 1.5, speedHz: 0.2 },
  },
  {
    id: 'figure8',
    label: 'Figure-8',
    description: 'Sweeps a lemniscate around you.',
    patch: { mode: 'figure8', radius: 1.8, speedHz: 0.3 },
  },
  {
    id: 'in-front-close',
    label: 'In Front (close)',
    description: 'Right where the screen is.',
    patch: { mode: 'manual', position: { x: 0, y: 0, z: -0.6 } },
  },
  {
    id: 'in-front-far',
    label: 'In Front (far)',
    description: 'Cinema-row distance.',
    patch: { mode: 'manual', position: { x: 0, y: 0, z: -3 } },
  },
  {
    id: 'behind',
    label: 'Behind You',
    description: 'Sound comes from over your shoulder.',
    patch: { mode: 'manual', position: { x: 0, y: 0, z: 1.5 } },
  },
  {
    id: 'above',
    label: 'Above Head',
    description: 'Voice-of-god overhead.',
    patch: { mode: 'manual', position: { x: 0, y: 1.5, z: 0 } },
  },
  {
    id: 'below',
    label: 'Below',
    description: 'Coming up from the floor.',
    patch: { mode: 'manual', position: { x: 0, y: -1.5, z: 0 } },
  },
  {
    id: 'left',
    label: 'Left Ear',
    description: 'Hard left.',
    patch: { mode: 'manual', position: { x: -1.5, y: 0, z: 0 } },
  },
  {
    id: 'right',
    label: 'Right Ear',
    description: 'Hard right.',
    patch: { mode: 'manual', position: { x: 1.5, y: 0, z: 0 } },
  },
];

const MODE_LABELS: Record<SpatialAudioMode, string> = {
  manual: 'Manual position',
  'room-front': 'Room speaker (stable)',
  'orbit-horizontal': 'Horizontal orbit',
  'orbit-vertical': 'Vertical tumble',
  figure8: 'Figure-8',
};

export default function SpatialAudioDialog({
  open,
  onOpenChange,
  value,
  onChange,
}: SpatialAudioDialogProps) {
  const padRef = useRef<HTMLDivElement>(null);

  const update = useCallback(
    (patch: Partial<SpatialAudioConfig>) => {
      const next: SpatialAudioConfig = {
        ...value,
        ...patch,
        position: { ...value.position, ...(patch.position ?? {}) },
      };
      onChange(next);
    },
    [value, onChange],
  );

  const applyPreset = useCallback(
    (preset: Preset) => {
      update({ ...preset.patch, enabled: true });
    },
    [update],
  );

  const handlePadPointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (value.mode !== 'manual') {
        // Switch to manual on first pad interaction so the drag does something visible.
        update({ mode: 'manual' });
      }
      const pad = padRef.current;
      if (!pad) return;
      pad.setPointerCapture(e.pointerId);
      const rect = pad.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = (e.clientX - cx) / (rect.width / 2);
      const dz = (e.clientY - cy) / (rect.height / 2);
      const clampedX = Math.max(-1, Math.min(1, dx));
      const clampedZ = Math.max(-1, Math.min(1, dz));
      // Pad maps to ±2 so dragging to the edge places the source clearly off to the side.
      update({ position: { x: clampedX * 2, y: value.position.y, z: clampedZ * 2 } });
    },
    [update, value.mode, value.position.y],
  );

  // Pad cursor position (mapping inverse of handlePadPointer's calc).
  const padX = Math.max(-1, Math.min(1, value.position.x / 2));
  const padZ = Math.max(-1, Math.min(1, value.position.z / 2));
  const isAnimatedMode =
    value.mode === 'orbit-horizontal' || value.mode === 'orbit-vertical' || value.mode === 'figure8';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] w-[min(100vw-1rem,54rem)] flex-col overflow-hidden rounded-2xl border border-border/60 p-0">
        <DialogHeader>
          <div className="border-b border-border/60 px-4 py-3 sm:px-6">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Headphones className="h-5 w-5" />
            8D / Spatial-Audio
          </DialogTitle>
          <DialogDescription className="pt-1 text-xs sm:text-sm">
            Shape the sound around you in a more natural way. Headphones work best for this.
            Turn it off anytime to go back to normal stereo.
          </DialogDescription>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 sm:space-y-5 sm:px-6">
          <button
            type="button"
            onClick={() => update({ enabled: !value.enabled })}
            className={cn(
              'flex w-full items-center justify-between rounded-lg border px-3 py-2.5 transition',
              value.enabled
                ? 'border-primary/50 bg-primary/10 text-foreground'
                : 'border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/50',
            )}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4" />
              Spatial-Audio is {value.enabled ? 'On' : 'Off'}
            </span>
            <span
              className={cn(
                'inline-flex h-5 w-9 shrink-0 rounded-full transition-colors',
                value.enabled ? 'bg-primary' : 'bg-secondary',
              )}
            >
              <span
                className={cn(
                  'pointer-events-none mt-0.5 ml-0.5 inline-block h-4 w-4 rounded-full bg-background shadow transition-transform',
                  value.enabled && 'translate-x-4',
                )}
              />
            </span>
          </button>

          <div className="space-y-2 rounded-xl border border-border/50 bg-muted/20 p-2.5 sm:p-3">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Presets
            </Label>
            <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={p.description}
                  onClick={() => applyPreset(p)}
                  className="rounded-md border border-border/60 bg-background/80 px-2 py-1.5 text-left text-xs font-medium hover:bg-muted/50"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 rounded-xl border border-border/50 bg-muted/15 p-2.5 sm:grid-cols-[auto,1fr] sm:p-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Position (top-down view)
              </Label>
              <div
                ref={padRef}
                onPointerDown={handlePadPointer}
                onPointerMove={(e) => {
                  if (e.buttons === 0) return;
                  handlePadPointer(e);
                }}
                className="relative h-[180px] w-[180px] cursor-crosshair rounded-full border border-border/60 bg-muted/20 sm:h-[220px] sm:w-[220px]"
              >
                {/** Crosshairs and listener marker */}
                <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border/50" />
                <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/50" />
                <div className="pointer-events-none absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/70" />
                <div className="pointer-events-none absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Front
                </div>
                <div className="pointer-events-none absolute -bottom-4 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Back
                </div>
                <div
                  className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow"
                  style={{
                    left: `${50 + padX * 50}%`,
                    top: `${50 + padZ * 50}%`,
                  }}
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Height (Y)
                  </Label>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {value.position.y.toFixed(2)}
                  </span>
                </div>
                <Slider
                  value={[value.position.y]}
                  min={-2}
                  max={2}
                  step={0.05}
                  onValueChange={(v) => update({ position: { y: v[0] ?? 0 } })}
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    Mode
                  </Label>
                  <span className="text-xs text-muted-foreground">{MODE_LABELS[value.mode]}</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {(Object.keys(MODE_LABELS) as SpatialAudioMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => update({ mode: m })}
                      className={cn(
                        'rounded-md border px-2 py-1 text-xs font-medium',
                        value.mode === m
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border/60 bg-muted/20 hover:bg-muted/50',
                      )}
                    >
                      {MODE_LABELS[m]}
                    </button>
                  ))}
                </div>
              </div>
              {value.mode === 'room-front' && (
                <div className="rounded-md border border-border/50 bg-background/70 px-2.5 py-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Radio className="h-3.5 w-3.5" />
                    Stable room feel - like standing in front of speakers.
                  </span>
                </div>
              )}
              {value.mode !== 'manual' && (
                <>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                        {value.mode === 'room-front' ? 'Speaker distance' : 'Orbit radius'}
                      </Label>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {value.radius.toFixed(2)}
                      </span>
                    </div>
                    <Slider
                      value={[value.radius]}
                      min={0.4}
                      max={4}
                      step={0.05}
                      onValueChange={(v) => update({ radius: v[0] ?? 1.5 })}
                    />
                  </div>
                  {isAnimatedMode && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                          Speed (Hz)
                        </Label>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {value.speedHz.toFixed(2)}
                        </span>
                      </div>
                      <Slider
                        value={[value.speedHz]}
                        min={0.05}
                        max={1.5}
                        step={0.01}
                        onValueChange={(v) => update({ speedHz: v[0] ?? 0.25 })}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 border-t border-border/60 px-4 py-3 sm:justify-between sm:px-6">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onChange({ ...DEFAULT_SPATIAL_CONFIG, enabled: value.enabled })}
          >
            Reset
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
