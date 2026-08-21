import { useCallback, useEffect, useRef, useState } from 'react';
import { Headphones, Sparkles, RotateCcw, Volume2 } from '~/components/icons';
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
import { Switch } from '~/components/ui/switch';
import { cn } from '~/lib/utils';
import {
  DEFAULT_SPATIAL_CONFIG,
  computeSpatialPosition,
  isAnimatedSpatialMode,
  type SpatialAudioConfig,
  type SpatialAudioMode,
} from '../../hooks/useSpatialAudio';

interface SpatialAudioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: SpatialAudioConfig;
  onChange: (next: SpatialAudioConfig) => void;
}

// Description fields intentionally removed  per UX feedback the dialog should
// surface labels only (the glyph + name carry the meaning), no explainer copy
// under each card / preset. Re-add a `description` field here if you ever
// want hover tooltips back; the render sites are kept simple on purpose.
interface ModeOption {
  id: SpatialAudioMode;
  label: string;
  /** Lucide-style emoji glyph for the card; keeps the design playful w/o extra deps. */
  glyph: string;
}

const MODES: ModeOption[] = [
  { id: 'stereo', label: 'Classic 8D', glyph: '↔' },
  { id: 'orbit', label: 'Orbit', glyph: '◯' },
  { id: 'tumble', label: 'Tumble', glyph: '⟳' },
  { id: 'figure8', label: 'Figure 8', glyph: '∞' },
  { id: 'room-front', label: 'Front Speakers', glyph: '◉' },
  { id: 'manual', label: 'Manual', glyph: '✛' },
];

const PRESETS: Array<{
  id: string;
  label: string;
  patch: Partial<SpatialAudioConfig>;
}> = [
  { id: 'classic-8d', label: 'Classic 8D', patch: { mode: 'stereo', radius: 1.6, speedHz: 0.2 } },
  { id: 'fast-8d', label: 'Fast 8D', patch: { mode: 'stereo', radius: 1.6, speedHz: 0.5 } },
  { id: 'wide-8d', label: 'Wide 8D', patch: { mode: 'stereo', radius: 2.6, speedHz: 0.18 } },
  { id: 'classic-orbit', label: 'Around Your Head', patch: { mode: 'orbit', radius: 1.5, speedHz: 0.22 } },
  { id: 'concert-hall', label: 'Concert Hall', patch: { mode: 'stereo', radius: 0.9, speedHz: 0.08 } },
  { id: 'in-room', label: 'In Front of You', patch: { mode: 'room-front', radius: 1.4, speedHz: 0.2 } },
];

const POSITION_PRESETS: Array<{
  id: string;
  label: string;
  position: { x: number; y: number; z: number };
}> = [
  { id: 'front', label: 'In Front', position: { x: 0, y: 0, z: -1.4 } },
  { id: 'behind', label: 'Behind', position: { x: 0, y: 0, z: 1.4 } },
  { id: 'left', label: 'Hard Left', position: { x: -1.6, y: 0, z: 0 } },
  { id: 'right', label: 'Hard Right', position: { x: 1.6, y: 0, z: 0 } },
  { id: 'above', label: 'Above', position: { x: 0, y: 1.5, z: 0 } },
  { id: 'below', label: 'Below', position: { x: 0, y: -1.5, z: 0 } },
];

/**
 * Live preview that mirrors what `useSpatialAudio` is actually applying to the panner.
 * Uses the same `computeSpatialPosition` helper, so the dot in the dialog moves exactly
 * in step with the audio source position the user is hearing.
 */
function LivePreview({ config }: { config: SpatialAudioConfig }) {
  const dotRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<HTMLDivElement>(null);
  const startedAtRef = useRef<number>(0);

  useEffect(() => {
    let raf = 0;
    let cancelled = false;

    const tick = (now: number) => {
      if (cancelled) return;
      if (startedAtRef.current === 0) startedAtRef.current = now;
      const pos = computeSpatialPosition(config, now, startedAtRef.current);
      // Top-down map: x axis is horizontal, z axis runs up the screen (front = top).
      // Clamp to the visible pad and convert to %.
      const padX = Math.max(-1, Math.min(1, pos.x / 2.5));
      const padZ = Math.max(-1, Math.min(1, pos.z / 2.5));
      const dot = dotRef.current;
      if (dot) {
        dot.style.left = `${50 + padX * 45}%`;
        dot.style.top = `${50 + padZ * 45}%`;
        // Scale the dot a touch when the source is "above" (y > 0): visual cue for height.
        const scale = 1 + Math.max(-0.4, Math.min(0.6, pos.y * 0.25));
        dot.style.transform = `translate(-50%, -50%) scale(${scale})`;
      }
      const trail = trailRef.current;
      if (trail) {
        trail.style.opacity = config.enabled ? '1' : '0.25';
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [config]);

  return (
    <div
      ref={trailRef}
      className="relative h-[220px] w-[220px] shrink-0 rounded-full border border-border/60 bg-background shadow-inner transition-opacity sm:h-[236px] sm:w-[236px]"
    >
      {/* Concentric range rings */}
      <div className="pointer-events-none absolute inset-[18%] rounded-full border border-border/40" />
      <div className="pointer-events-none absolute inset-[36%] rounded-full border border-border/30" />
      {/* Crosshairs */}
      <div className="pointer-events-none absolute inset-x-4 top-1/2 h-px -translate-y-1/2 bg-border/50" />
      <div className="pointer-events-none absolute inset-y-4 left-1/2 w-px -translate-x-1/2 bg-border/50" />
      {/* Cardinal labels */}
      <div className="pointer-events-none absolute inset-x-0 -top-2 text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Front
      </div>
      <div className="pointer-events-none absolute inset-x-0 -bottom-2 text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Back
      </div>
      <div className="pointer-events-none absolute -left-3 top-1/2 -translate-y-1/2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        L
      </div>
      <div className="pointer-events-none absolute -right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        R
      </div>
      {/* Listener (head) marker */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-foreground/85 text-background shadow">
        <Headphones className="h-3.5 w-3.5" />
      </div>
      {/* Animated source dot */}
      <div
        ref={dotRef}
        className={cn(
          'pointer-events-none absolute h-3.5 w-3.5 rounded-full transition-[background-color,box-shadow]',
          config.enabled
            ? 'bg-primary shadow-[0_0_20px_4px_hsl(var(--primary)/0.55)]'
            : 'bg-muted-foreground/50',
        )}
        style={{ left: '50%', top: '20%' }}
      />
    </div>
  );
}

export default function SpatialAudioDialog({
  open,
  onOpenChange,
  value,
  onChange,
}: SpatialAudioDialogProps) {
  const padRef = useRef<HTMLDivElement>(null);
  const [draggingPad, setDraggingPad] = useState(false);

  const update = useCallback(
    (patch: Omit<Partial<SpatialAudioConfig>, 'position'> & {
      position?: Partial<SpatialAudioConfig['position']>;
    }) => {
      onChange({
        ...value,
        ...patch,
        position: { ...value.position, ...(patch.position ?? {}) },
      });
    },
    [value, onChange],
  );

  const applyPreset = useCallback(
    (patch: Partial<SpatialAudioConfig>) => {
      update({ ...patch, enabled: true });
    },
    [update],
  );

  const handlePadPointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (value.mode !== 'manual') {
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

  const onPadPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setDraggingPad(true);
    handlePadPointer(e);
  };
  const onPadPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons === 0 && !draggingPad) return;
    handlePadPointer(e);
  };
  const onPadPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setDraggingPad(false);
    padRef.current?.releasePointerCapture(e.pointerId);
  };

  const isAnimated = isAnimatedSpatialMode(value.mode);
  const showRadius = value.mode !== 'manual';
  const showSpeed = isAnimated;
  const showManualPad = value.mode === 'manual';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] w-[min(100vw-1rem,42rem)] flex-col overflow-hidden rounded-2xl border border-border/60 p-0">
        <DialogHeader>
          <div className="border-b border-border/60 px-5 py-3.5">
            <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Headphones className="h-5 w-5 text-primary" />
              8D / Spatial Audio
            </DialogTitle>
            <DialogDescription className="sr-only">8D spatial audio settings</DialogDescription>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* Master toggle row */}
          <div
            className={cn(
              'flex items-center justify-between gap-3 rounded-xl border px-4 py-3 transition',
              value.enabled
                ? 'border-primary/50 bg-primary/10'
                : 'border-border/60 bg-muted/30',
            )}
          >
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
                  value.enabled ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground',
                )}
              >
                <Sparkles className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  Spatial audio is {value.enabled ? 'on' : 'off'}
                </div>
              </div>
            </div>
            <Switch
              checked={value.enabled}
              onCheckedChange={(v) => update({ enabled: v })}
              aria-label="Toggle spatial audio"
            />
          </div>

          {/* Visual preview + presets */}
          <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
            <div className="flex shrink-0 flex-col items-center gap-2">
              <LivePreview config={value} />
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Top view
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Quick presets
                </Label>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyPreset(p.patch)}
                      className="rounded-lg border border-border/60 bg-background px-2.5 py-2 text-left text-xs transition hover:-translate-y-px hover:border-primary/40 hover:bg-primary/5"
                    >
                      <div className="font-medium">{p.label}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Mode selector */}
          <div>
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Movement
            </Label>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {MODES.map((m) => {
                const active = value.mode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => update({ mode: m.id })}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition',
                      active
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border/60 bg-background hover:border-primary/40 hover:bg-primary/5',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-base font-semibold',
                        active
                          ? 'bg-primary/20 text-primary'
                          : 'bg-muted text-muted-foreground',
                      )}
                      aria-hidden
                    >
                      {m.glyph}
                    </span>
                    <span className="block min-w-0 text-xs font-medium">{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sliders */}
          {(showRadius || showSpeed) && (
            <div className="space-y-3 rounded-xl border border-border/50 bg-muted/15 p-3">
              {showRadius && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                      <Volume2 className="h-3.5 w-3.5" />
                      {value.mode === 'room-front' ? 'Speaker distance' : 'Width'}
                    </Label>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {value.radius.toFixed(2)}
                    </span>
                  </div>
                  <Slider
                    value={[value.radius]}
                    min={0.4}
                    max={3.5}
                    step={0.05}
                    onValueChange={(v) => update({ radius: v[0] ?? 1.5 })}
                  />
                </div>
              )}
              {showSpeed && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Speed
                    </Label>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {value.speedHz.toFixed(2)} Hz
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
            </div>
          )}

          {/* Manual position pad  only in manual mode */}
          {showManualPad && (
            <div className="space-y-3 rounded-xl border border-border/50 bg-muted/15 p-3">
              <div className="flex flex-wrap items-end gap-3 sm:flex-nowrap">
                <div className="space-y-1.5">
                  <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Position
                  </Label>
                  <div
                    ref={padRef}
                    onPointerDown={onPadPointerDown}
                    onPointerMove={onPadPointerMove}
                    onPointerUp={onPadPointerUp}
                    onPointerCancel={onPadPointerUp}
                    className="relative h-44 w-44 cursor-crosshair touch-none rounded-xl border border-border/60 bg-background/80 sm:h-48 sm:w-48"
                  >
                    <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border/50" />
                    <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/50" />
                    <div className="pointer-events-none absolute left-1/2 top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-foreground/80 text-background">
                      <Headphones className="h-3 w-3" />
                    </div>
                    <div className="pointer-events-none absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-wide text-muted-foreground">
                      Front
                    </div>
                    <div className="pointer-events-none absolute -bottom-4 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-wide text-muted-foreground">
                      Back
                    </div>
                    <div
                      className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow"
                      style={{
                        left: `${50 + Math.max(-1, Math.min(1, value.position.x / 2)) * 45}%`,
                        top: `${50 + Math.max(-1, Math.min(1, value.position.z / 2)) * 45}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="flex-1 space-y-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Height
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
                    <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Snap to
                    </Label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {POSITION_PRESETS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => update({ position: p.position })}
                          className="rounded-md border border-border/60 bg-background px-2 py-1.5 text-[11px] font-medium transition hover:border-primary/40 hover:bg-primary/5"
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 border-t border-border/60 bg-background/80 px-5 py-3 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange({ ...DEFAULT_SPATIAL_CONFIG, enabled: value.enabled })}
            className="gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset settings
          </Button>
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
