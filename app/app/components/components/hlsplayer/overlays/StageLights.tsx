import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePlayerContext } from '../PlayerContext';
import { STEM_TYPES, stemEventIndexAt, type StemType } from '../audioStems';
import { buildStemConfettiThemePalettes } from '../stemConfettiSettings';
import { cssColorToRgba, fileAccentColors, resolveThemeColorToken } from '../visualizerPalette';
import { useFullscreenContainer } from '../hooks/useFullscreenContainer';
import { toast } from '~/components/ui/sonner';
import {
  setStageLightsOwner,
  stageLightsOwner,
  useStageLightsOwner,
  useStageLightsSlotElement,
} from './stageLightsStore';

/**
 * Stage lights: while music plays, a band of liquid light runs around the
 * player (or around the whole page, if picked in the menu) with out of focus
 * studio lights floating on it.
 *
 * The band is a ring of springs (a 1D wave). It always ripples a little, its
 * colors flow around, and every hit from an instrument picked in the menu drops
 * a splash into it where that instrument lives (the kick at the floor, the
 * snare in the rig overhead). The splash runs around both ways, overshooting
 * and settling like jelly, and the dots riding the surface bob, swell and
 * flare as it passes. Only picked instruments splash.
 *
 * Colors follow the picture while it plays: like ambient mode the lights take a
 * fresh look every second or so and drift to what they see, lifted so they
 * glow. Paused, or on a gray picture, they drift back to the post's own colors,
 * and without those to the theme's colored tokens, then plain white light.
 *
 * Like ambient mode it sits behind the page and never takes input. In
 * fullscreen there is no page behind, so it rides the picture's edges under
 * the controls. The liquid is drawn tiny and stretched; the dots are sprites
 * stamped at screen resolution.
 */

const FRESH_WINDOW_S = 0.2;
const SEEK_RESYNC_S = 1.5;
const LIQUID_SCALE = 1 / 6;
const MAX_DOT_PIXELS = 4_000_000;
const SPRITE = 64;
/** How lit the set stays while the video is paused. */
const IDLE_LEVEL = 0.3;
const MAX_COLORS = 5;
/** Below this a color reads as gray and lights nothing. */
const MIN_VIVIDNESS = 0.14;
/** How often the lights look at the picture for its colors. */
const LOOK_MS = 900;
/** How quickly they drift to new colors (time constant, seconds). */
const COLOR_EASE_S = 0.6;
/** The frame is read this small: enough to find its colors, cheap to read back. */
const PROBE_W = 24;
const PROBE_H = 14;
/** Under this share of colorful pixels a frame has no color to give. */
const MIN_COLORFUL = 0.04;

/** Springs around the frame. */
const NODES = 180;
/** A splash reaches the far side of the frame in about this long. */
const HALF_LAP_S = 0.5;
const WAVE_SPEED = NODES / (2 * HALF_LAP_S);
/** Each node also springs back to rest: this is what makes it jiggle. */
const NODE_STIFFNESS = (2 * Math.PI * 2.4) ** 2;
const NODE_DAMPING = 3.2;
const SPLASH = 9;
const SPLASH_WIDTH = 3.2;
/** Node displacement that counts as a full flare. */
const FULL_FLARE = 0.32;

/** The whole band swells on hits and overshoots back. */
const SWELL_STIFFNESS = 140;
const SWELL_DAMPING = 7;

// A hit has to show on the frame it lands, like the bounce does, or the lights
// read as late. So it flashes the whole rig and jumps the band out right away,
// and only the wobble back and the ripple running round come after the beat.
/** The flash is gone well before the next beat (half life about 80ms). */
const FLASH_DECAY = 9;
const SWELL_JUMP = 0.55;
/** How far a splash lifts the band where it lands, on the hit frame. */
const SPLASH_LIFT = 0.35;

const PUSH: Record<StemType, number> = { kick: 1, bass: 0.75, snare: 0.6, hihat: 0.3, other: 0.5 };

type Rgb = { r: number; g: number; b: number };

interface Dot {
  /** Distance around the frame, clockwise from the top left corner. */
  s: number;
  /** How far out it floats, in band thicknesses. */
  depth: number;
  r: number;
  color: number;
  soft: boolean;
  idle: number;
  gain: number;
  sway: number;
  speed: number;
  phase: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A point on the frame and its inward normal, `s` px clockwise from the top
 * left. On a corner, `before` picks the side that ends there.
 */
function edgeAt(s: number, w: number, h: number, before = false) {
  const p = 2 * (w + h);
  let d = ((s % p) + p) % p;
  if (before && d === 0) d = p;
  const within = (a: number, b: number) => (before ? a <= b : a < b);
  if (within(d, w)) return { x: d, y: 0, nx: 0, ny: 1 };
  d -= w;
  if (within(d, h)) return { x: w, y: d, nx: -1, ny: 0 };
  d -= h;
  if (within(d, w)) return { x: w - d, y: h, nx: 0, ny: -1 };
  d -= w;
  return { x: 0, y: h - d, nx: 1, ny: 0 };
}

/** Where a hit splashes, as a share of the way around: kick and bass at the floor, the snare overhead. */
function splashAt(type: StemType, w: number, h: number, flip: boolean, rand: () => number): number {
  const p = 2 * (w + h);
  if (type === 'kick' || type === 'bass') return (w + h + w / 2) / p;
  if (type === 'snare') return w / 2 / p;
  if (type === 'other') return (flip ? w + h / 2 : 2 * w + h + h / 2) / p;
  return rand();
}

function toHsl({ r, g, b }: Rgb) {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h *= 60;
  return { h: h < 0 ? h + 360 : h, s, l };
}

function fromHsl(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

/** Chroma nudged toward brighter colors: how loudly a color reads as light. */
function vividness({ r, g, b }: Rgb): number {
  const max = Math.max(r, g, b) / 255;
  return (max - Math.min(r, g, b) / 255) * (0.4 + 0.6 * max);
}

/** Keeps the hue and lifts the color into something a light would throw. */
function asLight(c: Rgb, dark: boolean): Rgb {
  const { h, s, l } = toHsl(c);
  return fromHsl(h, Math.max(0.55, Math.min(1, s * 1.15)), dark ? Math.min(0.7, Math.max(0.58, l)) : Math.min(0.55, Math.max(0.45, l)));
}

function samePlace(a: Rgb, b: Rgb): boolean {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 70;
}

/** The colorful ones, lifted into light, with near repeats dropped. */
function asLights(candidates: (Rgb | null)[], dark: boolean): Rgb[] {
  const colors: Rgb[] = [];
  for (const c of candidates) {
    if (!c || vividness(c) < MIN_VIVIDNESS) continue;
    const light = asLight(c, dark);
    if (colors.some((o) => samePlace(o, light))) continue;
    colors.push(light);
    if (colors.length >= MAX_COLORS) break;
  }
  return colors;
}

/** One or two colors make a flat rig, so neighbouring hues fill it out to three. */
function widen(colors: Rgb[]): Rgb[] {
  if (colors.length === 0 || colors.length >= 3) return colors;
  const { h, s, l } = toHsl(colors[0]!);
  const out = [...colors, fromHsl((h + 22) % 360, s, l)];
  if (out.length < 3) out.push(fromHsl((h + 338) % 360, s, l));
  return out;
}

const parseCss = (css: string): Rgb | null => {
  const c = cssColorToRgba(css);
  return c ? { r: c.r, g: c.g, b: c.b } : null;
};

/** The resting colors: the post's own, or without those the theme's. */
function readPalette(fileColors: string[]): { colors: Rgb[]; dark: boolean } {
  const bg = cssColorToRgba(resolveThemeColorToken('background'));
  const dark = bg ? 0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b < 128 : true;
  const own = asLights(fileColors.map(parseCss), dark);
  if (own.length > 0) return { colors: widen(own), dark };
  const parse = parseCss;
  const themed = buildStemConfettiThemePalettes();
  const colors = asLights(
    [
      ...STEM_TYPES.map((t) => parse(themed[t].primary)),
      parse(resolveThemeColorToken('chart-1')),
      parse(resolveThemeColorToken('chart-5')),
    ],
    dark,
  );
  if (colors.length < 3) {
    if (dark) {
      // A monochrome theme on a dark video: white spots, the classic stage look.
      const plain = parse(resolveThemeColorToken('foreground'));
      colors.push(plain ?? { r: 235, g: 235, b: 235 });
    } else if (colors.length > 0) {
      // Gray reads as dust on a light page, so vary the one color there is.
      const { h, s, l } = toHsl(colors[0]!);
      colors.push(fromHsl(h, s, Math.max(0.3, l - 0.14)), fromHsl(h, s, Math.min(0.68, l + 0.12)));
    } else {
      const plain = parse(resolveThemeColorToken('primary'));
      if (plain) colors.push(plain);
    }
  }
  if (colors.length === 0) colors.push({ r: 128, g: 128, b: 128 });
  return { colors, dark };
}

/**
 * The colors a frame is made of: tinted pixels pooled by hue, brighter and
 * stronger ones counting more, strongest first. A dark scene still has a hue
 * worth lighting (a deep teal night lights teal), so this goes by tint rather
 * than loudness. Empty when the frame is mostly gray, white or black.
 */
function frameColors(data: Uint8ClampedArray, dark: boolean): Rgb[] {
  const bins = Array.from({ length: 12 }, () => ({ r: 0, g: 0, b: 0, w: 0 }));
  let colorful = 0;
  for (let i = 0; i < data.length; i += 4) {
    const c = { r: data[i]!, g: data[i + 1]!, b: data[i + 2]! };
    const max = Math.max(c.r, c.g, c.b);
    const chroma = (max - Math.min(c.r, c.g, c.b)) / 255;
    if (max < 20 || chroma < 0.05) continue;
    const { h, s } = toHsl(c);
    if (s < 0.2) continue;
    colorful++;
    const bin = bins[Math.floor(h / 30) % 12]!;
    const w = chroma * (0.3 + max / 255);
    bin.r += c.r * w;
    bin.g += c.g * w;
    bin.b += c.b * w;
    bin.w += w;
  }
  if (colorful < (data.length / 4) * MIN_COLORFUL) return [];
  const ranked = bins.filter((b) => b.w > 0).sort((a, b) => b.w - a.w);
  const top = ranked[0]?.w ?? 0;
  const out: Rgb[] = [];
  for (const b of ranked) {
    if (b.w < top * 0.12) break;
    const light = asLight({ r: b.r / b.w, g: b.g / b.w, b: b.b / b.w }, dark);
    if (out.some((o) => samePlace(o, light))) continue;
    out.push(light);
    if (out.length >= MAX_COLORS) break;
  }
  return out;
}

/** Lays a palette over the fixed color slots, each slot taking the nearest color so the drift between looks stays short. */
function assignSlots(current: Rgb[], palette: Rgb[], slots: number): Rgb[] {
  const pool = Array.from({ length: slots }, (_, i) => palette[i % palette.length]!);
  if (current.length !== slots) return pool.map((c) => ({ ...c }));
  const used = new Array<boolean>(slots).fill(false);
  return current.map((c) => {
    let best = 0;
    let bestD = Infinity;
    for (let j = 0; j < slots; j++) {
      if (used[j]) continue;
      const p = pool[j]!;
      const d = Math.abs(p.r - c.r) + Math.abs(p.g - c.g) + Math.abs(p.b - c.b);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    used[best] = true;
    return { ...pool[best]! };
  });
}

function sprite(rgb: Rgb, soft: boolean, c = document.createElement('canvas')): HTMLCanvasElement {
  c.width = SPRITE;
  c.height = SPRITE;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const half = SPRITE / 2;
  const g = ctx.createRadialGradient(half, half, 0, half, half, half);
  const [r, gr, b] = [Math.round(rgb.r), Math.round(rgb.g), Math.round(rgb.b)];
  const at = (a: number) => `rgba(${r}, ${gr}, ${b}, ${a})`;
  if (soft) {
    // A defocused light: flat disc, a brighter rim, then a wide glow.
    g.addColorStop(0, at(0.62));
    g.addColorStop(0.3, at(0.7));
    g.addColorStop(0.38, at(0.9));
    g.addColorStop(0.45, at(0.3));
    g.addColorStop(1, at(0));
  } else {
    // A small light in focus: hot center, tight halo.
    g.addColorStop(0, at(1));
    g.addColorStop(0.18, at(1));
    g.addColorStop(0.32, at(0.4));
    g.addColorStop(1, at(0));
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SPRITE, SPRITE);
  return c;
}

function layoutDots(w: number, h: number, colorCount: number): Dot[] {
  const rand = mulberry32(0x5eed);
  const perimeter = 2 * (w + h);
  const small = Math.min(w, h) < 640;
  const count = Math.round(Math.min(96, Math.max(28, perimeter / (small ? 52 : 60))));
  // Neighbours rarely share a color, while the mix stays even.
  const colors = Array.from({ length: count }, (_, i) => i % colorCount);
  for (let i = colors.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [colors[i], colors[j]] = [colors[j]!, colors[i]!];
  }
  return Array.from({ length: count }, (_, i) => {
    const near = rand();
    const r = (2.5 + 11 * near * near) * (small ? 0.8 : 1);
    const soft = r > 6;
    return {
      s: ((i + 0.1 + rand() * 0.8) / count) * perimeter,
      depth: 0.25 + 1.5 * Math.pow(rand(), 1.4),
      r,
      color: colors[i]!,
      soft,
      idle: soft ? 0.16 + 0.1 * rand() : 0.3 + 0.15 * rand(),
      gain: soft ? 0.65 : 0.9,
      sway: 2 + 7 * near,
      speed: 0.15 + 0.3 * rand(),
      phase: rand() * Math.PI * 2,
    };
  });
}

let toldAmbientPaused = false;

export default function StageLights() {
  const {
    videoRef,
    containerRef,
    audioStems,
    visualizerConfetti,
    videoBounceInstruments,
    stageLightsScope,
    stageLightsPauseAmbient,
    setStageLightsPauseAmbient,
    ambientMode,
    authPlaybackFeatures,
    state,
    file,
  } = usePlayerContext();
  const fullscreenEl = useFullscreenContainer();
  const slot = useStageLightsSlotElement();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const liquidRef = useRef<HTMLCanvasElement>(null);
  const dotsRef = useRef<HTMLCanvasElement>(null);
  const wakeRef = useRef<() => void>(() => {});

  const playing = state.isPlaying && !state.isPaused;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const stemsRef = useRef(audioStems);
  stemsRef.current = audioStems;

  const typesKey = useMemo(
    () => STEM_TYPES.filter((t) => videoBounceInstruments[t]).join(','),
    [videoBounceInstruments],
  );
  const fileColorsKey = fileAccentColors(file?.colors).join(',');
  const enabled = visualizerConfetti && audioStems != null && typesKey !== '';
  // Around the player, unless the page was picked. Fullscreen has no page
  // behind it, so there the lights ride the picture's edges.
  const framed = stageLightsScope !== 'page' && !fullscreenEl;

  const [id] = useState(() => Symbol('stage-lights'));
  const current = useStageLightsOwner();
  // Claims on starting to play, or when nobody holds the lights; never in a
  // loop, so two players playing at once settle on one.
  useEffect(() => {
    if (enabled && playing) setStageLightsOwner(id);
  }, [enabled, playing, id]);
  useEffect(() => {
    if (enabled && current === null) setStageLightsOwner(id);
  }, [enabled, current, id]);
  useEffect(() => {
    if (!enabled && stageLightsOwner() === id) setStageLightsOwner(null);
  }, [enabled, id]);
  useEffect(
    () => () => {
      if (stageLightsOwner() === id) setStageLightsOwner(null);
    },
    [id],
  );
  const active = enabled && mounted && current === id;

  // Says once a visit that ambient stepped aside, with a way to keep both on.
  const pausesAmbient = active && ambientMode && stageLightsPauseAmbient && authPlaybackFeatures;
  useEffect(() => {
    if (!pausesAmbient || toldAmbientPaused) return;
    toldAmbientPaused = true;
    toast('Ambient mode paused for stage lights', {
      description: 'Saves battery. You can change this in settings.',
      action: { label: 'Keep both on', onClick: () => setStageLightsPauseAmbient(false) },
    });
  }, [pausesAmbient, setStageLightsPauseAmbient]);

  useEffect(() => {
    if (playing) wakeRef.current();
  }, [playing]);

  useEffect(() => {
    if (!active) return;
    const liquidCanvas = liquidRef.current;
    const dotsCanvas = dotsRef.current;
    const host = liquidCanvas?.parentElement;
    const player = framed ? containerRef.current : null;
    if (!liquidCanvas || !dotsCanvas || !host || (framed && !player)) return;
    const liquid = liquidCanvas.getContext('2d');
    const dots = dotsCanvas.getContext('2d');
    // The band is drawn here first, then softened onto the visible canvas in one pass.
    const bandCanvas = document.createElement('canvas');
    const band = bandCanvas.getContext('2d');
    if (!liquid || !dots || !band) return;
    const canBlur = typeof liquid.filter === 'string';
    // Safari has no canvas filter; shrinking the band and stretching it back softens it instead.
    const softCanvas = canBlur ? null : document.createElement('canvas');
    const soft = softCanvas?.getContext('2d') ?? null;
    if (soft) soft.imageSmoothingQuality = 'high';

    const picked = typesKey.split(',') as StemType[];
    const fileColors = fileColorsKey ? fileColorsKey.split(',') : [];
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const rand = mulberry32(0xbea7);
    // Around the player the light spills outward; on the page edges it reaches in.
    const out = framed ? -1 : 1;

    // The frame the band runs around is w by h, `margin` in from the canvas edge.
    let w = 0;
    let h = 0;
    let margin = 0;
    let lw = 1;
    let lh = 1;
    let onScreen = true;
    let scale = 1;
    let dotList: Dot[] = [];
    let dark = true;
    // Color slots drift toward `goal`: what the picture shows, or `resting`, the post's colors.
    let colors: Rgb[] = [];
    let goal: Rgb[] = [];
    let resting: Rgb[] = [];
    let atRest = true;
    let leds: HTMLCanvasElement[] = [];
    let bokeh: HTMLCanvasElement[] = [];
    let spriteColors: Rgb[] = [];
    let spritesAt = 0;

    const probe = document.createElement('canvas');
    probe.width = PROBE_W;
    probe.height = PROBE_H;
    const probeCtx = probe.getContext('2d', { willReadFrequently: true });
    let canLook = probeCtx != null;
    let nextLook = 0;
    /** The colors of the frame on screen, or null when there is no frame to read. */
    const look = (): Rgb[] | null => {
      const video = videoRef.current;
      if (!canLook || !probeCtx || !video || video.readyState < 2 || !video.videoWidth) return null;
      try {
        probeCtx.drawImage(video, 0, 0, PROBE_W, PROBE_H);
        return frameColors(probeCtx.getImageData(0, 0, PROBE_W, PROBE_H).data, dark);
      } catch {
        // A picture from another origin can't be read back; the post's colors stay.
        canLook = false;
        return null;
      }
    };

    const paintSprites = (now: number) => {
      leds = colors.map((c, i) => sprite(c, false, leds[i]));
      bokeh = colors.map((c, i) => sprite(c, true, bokeh[i]));
      spriteColors = colors.map((c) => ({ ...c }));
      spritesAt = now;
    };

    const paintTheme = () => {
      const palette = readPalette(fileColors);
      dark = palette.dark;
      resting = palette.colors;
      if (colors.length === 0) colors = assignSlots([], resting, MAX_COLORS);
      goal = assignSlots(colors, resting, MAX_COLORS);
      atRest = true;
      nextLook = 0;
      paintSprites(performance.now());
      // Light only adds on a dark page; on a light one it lays color down.
      host.style.mixBlendMode = dark ? 'screen' : 'normal';
    };

    const setMask = (el: HTMLElement, image: string, composite: 'add' | 'intersect') => {
      el.style.setProperty('mask-image', image);
      el.style.setProperty('-webkit-mask-image', image);
      el.style.setProperty('mask-composite', composite);
      el.style.setProperty('-webkit-mask-composite', composite === 'intersect' ? 'source-in' : 'source-over');
    };

    const resize = () => {
      lw = w + 2 * margin;
      lh = h + 2 * margin;
      scale = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_DOT_PIXELS / (lw * lh)));
      dotsCanvas.width = Math.round(lw * scale);
      dotsCanvas.height = Math.round(lh * scale);
      liquidCanvas.width = bandCanvas.width = Math.max(8, Math.round(lw * LIQUID_SCALE));
      liquidCanvas.height = bandCanvas.height = Math.max(8, Math.round(lh * LIQUID_SCALE));
      if (softCanvas) {
        softCanvas.width = Math.max(4, Math.round(bandCanvas.width / 2));
        softCanvas.height = Math.max(4, Math.round(bandCanvas.height / 2));
      }
      dotList = layoutDots(w, h, colors.length);
      wake();
    };

    let tx = 0;
    let ty = 0;
    /**
     * Lines the layer up with the player, or with the screen. The page's slot
     * can be a container query box, which pins fixed children to itself rather
     * than the screen, so the layer measures where it really starts.
     */
    const place = () => {
      const rect = player
        ? player.getBoundingClientRect()
        : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      const fw = Math.max(1, Math.round(rect.width));
      const fh = Math.max(1, Math.round(rect.height));
      const m = player ? Math.round(Math.min(200, Math.max(56, Math.min(fw, fh) * 0.28))) : 0;
      const at = host.getBoundingClientRect();
      const x = Math.round(rect.left - m - (at.left - tx));
      const y = Math.round(rect.top - m - (at.top - ty));
      if (x !== tx || y !== ty) {
        tx = x;
        ty = y;
        host.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }
      onScreen =
        rect.left - m < window.innerWidth &&
        rect.top - m < window.innerHeight &&
        rect.left + fw + m > 0 &&
        rect.top + fh + m > 0;
      if (fw === w && fh === h && m === margin) return;
      w = fw;
      h = fh;
      margin = m;
      host.style.width = `${w + 2 * m}px`;
      host.style.height = `${h + 2 * m}px`;
      if (player) {
        // Full strength at the player, fading out toward the edge of the spill.
        const ramp = (dir: string) =>
          `linear-gradient(${dir}, transparent, black ${Math.round(m * 0.6)}px, black calc(100% - ${Math.round(m * 0.6)}px), transparent)`;
        setMask(host, `${ramp('to right')}, ${ramp('to bottom')}`, 'intersect');
      } else {
        const fade = 'min(24vw, 24vh)';
        const ramp = (dir: string) =>
          `linear-gradient(${dir}, black, transparent ${fade}, transparent calc(100% - ${fade}), black)`;
        setMask(liquidCanvas, `${ramp('to right')}, ${ramp('to bottom')}`, 'add');
      }
      resize();
    };

    // The liquid: displacement and velocity of each spring around the frame.
    const y = new Float32Array(NODES);
    const v = new Float32Array(NODES);
    const thick = new Float32Array(NODES + 1);
    const flare = new Float32Array(NODES + 1);
    let swell = 0;
    let swellVel = 0;
    let flash = 0;
    let tension = 0;
    let master = playingRef.current ? 1 : IDLE_LEVEL;
    let flow = 0;
    let lastNow = 0;
    let idx = 0;
    let lastTime = 0;
    let lastEvents: unknown = null;
    let flip = false;
    let rafId: number | null = null;

    const splash = (at: number, strength: number) => {
      const center = at * NODES;
      for (let k = -10; k <= 10; k++) {
        const i = (((Math.round(center) + k) % NODES) + NODES) % NODES;
        const g = Math.exp(-(k * k) / (2 * SPLASH_WIDTH * SPLASH_WIDTH));
        y[i] += strength * SPLASH_LIFT * g;
        v[i] += strength * SPLASH * 0.5 * g;
      }
    };

    const stepWave = (dt: number) => {
      const steps = Math.ceil((dt * WAVE_SPEED) / 0.7);
      const sub = dt / steps;
      const c2 = WAVE_SPEED * WAVE_SPEED;
      for (let n = 0; n < steps; n++) {
        for (let i = 0; i < NODES; i++) {
          const left = y[(i + NODES - 1) % NODES]!;
          const right = y[(i + 1) % NODES]!;
          const acc = c2 * (left + right - 2 * y[i]!) - NODE_STIFFNESS * y[i]! - NODE_DAMPING * v[i]!;
          v[i] = v[i]! + acc * sub;
        }
        for (let i = 0; i < NODES; i++) y[i] = y[i]! + v[i]! * sub;
      }
    };

    /** Band thickness and flare at `s` px around the frame, read off the springs. */
    const sample = (s: number) => {
      const perimeter = 2 * (w + h);
      const u = ((((s / perimeter) % 1) + 1) % 1) * NODES;
      const i = Math.min(NODES - 1, Math.floor(u));
      const f = u - i;
      return {
        th: thick[i]! * (1 - f) + thick[i + 1]! * f,
        fl: flare[i]! * (1 - f) + flare[i + 1]! * f,
      };
    };

    const draw = () => {
      const perimeter = 2 * (w + h);
      const still = reduceMotion.matches;
      const base = framed ? margin * 0.34 : Math.min(w, h) * 0.07;
      const breathe = 1 + 0.4 * swell + 0.2 * flash;

      for (let i = 0; i <= NODES; i++) {
        const n = i % NODES;
        const a = (n / NODES) * Math.PI * 2;
        const ripple = still ? 0 : 0.22 * Math.sin(3 * a + flow * 1.3) + 0.14 * Math.sin(7 * a - flow * 2.1 + 1.7);
        thick[i] = Math.max(base * 0.25, base * (1 + ripple) * breathe + y[n]! * base * 1.6);
        flare[i] = Math.min(1, Math.abs(y[n]!) / FULL_FLARE + Math.max(0, swell) * 0.5 + flash * 0.7);
      }

      const colorShift = flow * 0.05;
      const shade = (s: number, strength: number) => {
        const u = (((s / perimeter) * colors.length + colorShift) % colors.length + colors.length) % colors.length;
        const c0 = colors[Math.floor(u)]!;
        const c1 = colors[(Math.floor(u) + 1) % colors.length]!;
        const f = u - Math.floor(u);
        const alpha = master * strength * (0.42 + 0.5 * sample(s).fl) * (dark ? 1 : 0.55);
        return `rgba(${Math.round(c0.r + (c1.r - c0.r) * f)}, ${Math.round(c0.g + (c1.g - c0.g) * f)}, ${Math.round(c0.b + (c1.b - c0.b) * f)}, ${Math.min(1, alpha)})`;
      };

      const ls = bandCanvas.width / lw;
      band.setTransform(1, 0, 0, 1, 0, 0);
      band.clearRect(0, 0, bandCanvas.width, bandCanvas.height);
      band.setTransform(ls, 0, 0, ls, ls * margin, ls * margin);
      const corners = [w, w + h, 2 * w + h, perimeter];
      const seg = perimeter / NODES;

      const piece = (s0: number, s1: number, toCorner: boolean, reach: number, strength: number) => {
        const e0 = edgeAt(s0, w, h);
        const e1 = edgeAt(s1, w, h, toCorner);
        const t0 = sample(s0).th * reach;
        const t1 = sample(s1).th * reach;
        band.fillStyle = shade(s0, strength);
        band.beginPath();
        band.moveTo(e0.x - out * e0.nx * 2, e0.y - out * e0.ny * 2);
        band.lineTo(e1.x - out * e1.nx * 2, e1.y - out * e1.ny * 2);
        band.lineTo(e1.x + out * e1.nx * t1, e1.y + out * e1.ny * t1);
        band.lineTo(e0.x + out * e0.nx * t0, e0.y + out * e0.ny * t0);
        band.closePath();
        band.fill();
      };

      // Spilling outward, each corner needs a wedge or the band shows a notch there.
      const wedge = (c: number, reach: number, strength: number) => {
        const a = edgeAt(c, w, h, true);
        const b = edgeAt(c, w, h);
        let a0 = Math.atan2(-a.ny, -a.nx);
        let a1 = Math.atan2(-b.ny, -b.nx);
        if (a1 < a0) a1 += Math.PI * 2;
        band.fillStyle = shade(c, strength);
        band.beginPath();
        band.moveTo(a.x, a.y);
        band.arc(a.x, a.y, sample(c).th * reach, a0, a1);
        band.closePath();
        band.fill();
      };

      // Two passes: a wide faint halo, then the bright body of the liquid.
      for (const [reach, strength] of [
        [2.3, 0.3],
        [1, 1],
      ] as const) {
        for (let i = 0; i < NODES; i++) {
          let s0 = i * seg;
          const s1 = (i + 1) * seg;
          for (const c of corners) {
            if (c <= s0 + 1e-6 || c > s1 + 1e-6) continue;
            piece(s0, c, true, reach, strength);
            if (framed) wedge(c, reach, strength);
            s0 = c;
          }
          if (s1 - s0 <= 1e-6) continue;
          // A hair of overlap so neighbouring pieces never show a seam, stopping at the corner.
          const corner = corners.find((c) => c > s0 + 1e-6) ?? perimeter;
          const end = Math.min(s1 + seg * 0.15, corner);
          piece(s0, end, end === corner, reach, strength);
        }
      }

      liquid.setTransform(1, 0, 0, 1, 0, 0);
      liquid.clearRect(0, 0, liquidCanvas.width, liquidCanvas.height);
      if (canBlur) {
        liquid.filter = 'blur(2px)';
        liquid.drawImage(bandCanvas, 0, 0);
        liquid.filter = 'none';
      } else if (soft && softCanvas) {
        soft.clearRect(0, 0, softCanvas.width, softCanvas.height);
        soft.drawImage(bandCanvas, 0, 0, softCanvas.width, softCanvas.height);
        liquid.drawImage(softCanvas, 0, 0, liquidCanvas.width, liquidCanvas.height);
      } else {
        liquid.drawImage(bandCanvas, 0, 0);
      }

      dots.setTransform(1, 0, 0, 1, 0, 0);
      dots.clearRect(0, 0, dotsCanvas.width, dotsCanvas.height);
      dots.setTransform(scale, 0, 0, scale, scale * margin, scale * margin);
      dots.globalCompositeOperation = dark ? 'lighter' : 'source-over';
      for (const dot of dotList) {
        const { th, fl } = sample(dot.s);
        const e = edgeAt(dot.s, w, h);
        const swayX = still ? 0 : Math.sin(dot.phase + flow * dot.speed) * dot.sway;
        const swayY = still ? 0 : Math.cos(dot.phase * 1.3 + flow * dot.speed * 0.8) * dot.sway * 0.6;
        const radius = dot.r * (1 + 0.55 * fl);
        // Dots float on the liquid, so a passing wave lifts them and swells them.
        let lift = 6 + dot.depth * th;
        if (framed) lift = Math.min(lift, margin * 0.8);
        const half = radius / (dot.soft ? 0.38 : 0.22);
        dots.globalAlpha = Math.min(1, master * (dot.idle + dot.gain * fl));
        dots.drawImage(
          (dot.soft ? bokeh : leds)[dot.color]!,
          e.x + out * e.nx * lift + swayX - half,
          e.y + out * e.ny * lift + swayY - half,
          half * 2,
          half * 2,
        );
      }
      dots.globalAlpha = 1;
    };

    const tick = (now: number) => {
      rafId = null;
      const dt = Math.min(0.05, lastNow > 0 ? (now - lastNow) / 1000 : 1 / 60);
      lastNow = now;
      const live = playingRef.current;
      const still = reduceMotion.matches;
      place();

      flash *= Math.exp(-FLASH_DECAY * dt);
      const video = videoRef.current;
      const stems = stemsRef.current;
      if (live && video && stems) {
        const t = video.currentTime;
        const evs = stems.events;
        // A new video brings new events; a jump in time means a seek.
        if (evs !== lastEvents || t < lastTime - 0.05 || t - lastTime > SEEK_RESYNC_S) {
          idx = stemEventIndexAt(evs, t);
          lastEvents = evs;
        }
        while (idx < evs.length && evs[idx]!.t <= t) {
          const e = evs[idx]!;
          idx++;
          if (t - e.t > FRESH_WINDOW_S || !picked.includes(e.type)) continue;
          const push = e.s * PUSH[e.type];
          flash = Math.min(1, flash + push * (still ? 0.6 : 1));
          swell = Math.min(1.4, swell + push * (still ? 0.25 : SWELL_JUMP));
          tension = Math.min(1.5, tension + 0.12 * e.s);
          if (e.type === 'other') flip = !flip;
          if (!still) splash(splashAt(e.type, w, h, flip, rand), push);
        }
        lastTime = t;
      }

      if (live) {
        if (now >= nextLook) {
          nextLook = now + LOOK_MS;
          const seen = look();
          if (seen) {
            goal = assignSlots(colors, seen.length > 0 ? widen(seen) : resting, MAX_COLORS);
            atRest = false;
          }
        }
      } else if (!atRest) {
        goal = assignSlots(colors, resting, MAX_COLORS);
        atRest = true;
        nextLook = 0;
      }
      const ease = 1 - Math.exp(-dt / COLOR_EASE_S);
      let drift = 0;
      for (let i = 0; i < colors.length; i++) {
        const c = colors[i]!;
        const to = goal[i]!;
        c.r += (to.r - c.r) * ease;
        c.g += (to.g - c.g) * ease;
        c.b += (to.b - c.b) * ease;
        drift = Math.max(drift, Math.abs(to.r - c.r) + Math.abs(to.g - c.g) + Math.abs(to.b - c.b));
      }
      // At their size the dots only need new sprites a few times a second.
      if (
        now - spritesAt > 100 &&
        colors.some((c, i) => {
          const s = spriteColors[i]!;
          return Math.abs(c.r - s.r) + Math.abs(c.g - s.g) + Math.abs(c.b - s.b) > 4;
        })
      ) {
        paintSprites(now);
      }

      stepWave(dt);
      swellVel += -swell * SWELL_STIFFNESS * dt;
      swellVel *= Math.exp(-SWELL_DAMPING * dt);
      swell = Math.max(-0.4, Math.min(1.4, swell + swellVel * dt));
      tension = Math.max(0, tension - 0.4 * dt);
      const target = live ? 1 : IDLE_LEVEL;
      master += (target - master) * Math.min(1, dt * 3);
      // Music speeds the flow up; after it stops the liquid drifts to rest.
      flow += dt * (live ? 1 + 0.8 * tension : 0.3);

      let moving =
        drift > 1 ||
        flash > 0.004 || Math.abs(swell) > 0.004 || Math.abs(swellVel) > 0.004 || Math.abs(target - master) > 0.005;
      for (let i = 0; i < NODES && !moving; i++) moving = Math.abs(y[i]!) > 0.002 || Math.abs(v[i]!) > 0.01;

      if (onScreen) draw();
      if ((live || moving) && document.visibilityState === 'visible') rafId = requestAnimationFrame(tick);
    };

    function wake() {
      if (rafId == null) {
        lastNow = 0;
        rafId = requestAnimationFrame(tick);
      }
    }
    wakeRef.current = wake;

    paintTheme();
    place();

    const ro = new ResizeObserver(place);
    if (player) ro.observe(player);
    // Paused, nothing redraws, but the layer still has to keep up with scrolling.
    window.addEventListener('scroll', place, { capture: true, passive: true });
    window.addEventListener('resize', place);
    // The theme follows the class on <html>, or the system setting in system mode.
    const retheme = () => {
      paintTheme();
      dotList = layoutDots(w, h, colors.length);
      wake();
    };
    const mo = new MutationObserver(retheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
    systemDark.addEventListener('change', retheme);
    const onVisible = () => {
      if (document.visibilityState === 'visible') wake();
    };
    document.addEventListener('visibilitychange', onVisible);
    reduceMotion.addEventListener('change', wake);

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      wakeRef.current = () => {};
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('scroll', place, { capture: true });
      window.removeEventListener('resize', place);
      systemDark.removeEventListener('change', retheme);
      document.removeEventListener('visibilitychange', onVisible);
      reduceMotion.removeEventListener('change', wake);
      for (const el of [host, liquidCanvas]) {
        for (const p of ['mask-image', '-webkit-mask-image', 'mask-composite', '-webkit-mask-composite']) {
          el.style.removeProperty(p);
        }
      }
      for (const p of ['transform', 'width', 'height']) host.style.removeProperty(p);
      dotsCanvas.width = 0;
      liquidCanvas.width = 0;
      bandCanvas.width = 0;
    };
  }, [active, framed, slot, typesKey, fileColorsKey, videoRef, containerRef, fullscreenEl]);

  if (!active) return null;

  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 select-none"
      // Behind the page's content like ambient mode. In fullscreen: over the picture, under the controls.
      style={{ zIndex: fullscreenEl ? 31 : -1, contain: 'strict' }}
    >
      <canvas ref={liquidRef} className="absolute inset-0 h-full w-full" />
      <canvas ref={dotsRef} className="absolute inset-0 h-full w-full" />
    </div>,
    fullscreenEl ?? slot ?? document.body,
  );
}
