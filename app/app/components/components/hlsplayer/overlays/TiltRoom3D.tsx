import type { CSSProperties } from 'react';
import type { TiltRotation } from '../PlayerContext';

/**
 * Pure-CSS 3D room for tilt mode. Five themed planes (back wall, side walls,
 * ceiling, floor) live in a preserve-3d world together with the video
 * "screen". Dragging rotates the WORLD, so the parallax between the screen
 * and the walls reads as standing inside a room — no canvas/WebGL involved.
 */

/** Wide-ish FOV: smaller perspective = more "inside the room". */
export const TILT_ROOM_PERSPECTIVE_PX = 520;
/** How deep the room extends behind the viewport plane. */
const ROOM_DEPTH_PX = 480;
/** Resting depth of the video screen inside the room. */
const SCREEN_BASE_Z_PX = -120;
/** Walls overshoot the container so edges stay covered while orbiting. */
const WALL_BLEED = '-30%';

/** World group: rotation only — children carry their own depth. */
export function tiltWorldStyle(rotation: TiltRotation): CSSProperties {
  return {
    transformStyle: 'preserve-3d',
    transform: `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg) rotateZ(${rotation.z}deg)`,
    transition: 'transform 120ms ease-out',
    willChange: 'transform',
  };
}

/** Screen depth: zoom dollies the video toward the viewer inside the room. */
export function tiltScreenZ(zoom: number, extraZ = 0): number {
  return SCREEN_BASE_Z_PX + (zoom - 1) * 160 + extraZ;
}

export function tiltScreenStyle(zoom: number, extraZ = 0): CSSProperties {
  return {
    transform: `translateZ(${tiltScreenZ(zoom, extraZ)}px) scale(${0.85 * zoom})`,
    transformOrigin: '50% 50%',
    transition: 'transform 120ms ease-out',
    willChange: 'transform',
    backfaceVisibility: 'hidden',
    borderRadius: '10px',
  };
}

/** Centered screen box sized to the video's object-contain rect (keeps aspect in 3D). */
export function tiltScreenBoxStyle(
  width: number,
  height: number,
  zoom: number,
  extraZ = 0,
): CSSProperties {
  const hasSize = width > 0 && height > 0;
  return {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: hasSize ? width : '100%',
    height: hasSize ? height : '100%',
    marginLeft: hasSize ? -width / 2 : '-50%',
    marginTop: hasSize ? -height / 2 : '-50%',
    transformStyle: 'preserve-3d',
    ...tiltScreenStyle(zoom, extraZ),
  };
}

const wallBase: CSSProperties = {
  position: 'absolute',
  backfaceVisibility: 'hidden',
};

/** Soft grid lines so wall movement is readable while orbiting. */
const gridLines = (axis: 'h' | 'v') =>
  `repeating-linear-gradient(${axis === 'h' ? '0deg' : '90deg'}, hsl(var(--border) / 0.16) 0px, hsl(var(--border) / 0.16) 1px, transparent 1px, transparent 72px)`;

export default function TiltRoomWalls({ zoom }: { zoom: number }) {
  // The screen's light spills onto the room — brighter when dollied closer.
  const glow = 0.05 + Math.max(0, zoom - 0.6) * 0.04;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[1]"
      style={{ transformStyle: 'preserve-3d' }}
    >
      {/* Back wall */}
      <div
        style={{
          ...wallBase,
          inset: WALL_BLEED,
          transform: `translateZ(${-ROOM_DEPTH_PX}px)`,
          background: [
            `radial-gradient(ellipse 60% 50% at 50% 48%, hsl(var(--primary) / ${glow}) 0%, transparent 70%)`,
            gridLines('h'),
            gridLines('v'),
            'linear-gradient(to bottom, hsl(var(--muted) / 0.9) 0%, hsl(var(--background)) 78%)',
          ].join(', '),
          boxShadow: 'inset 0 0 140px hsl(var(--background) / 0.9)',
        }}
      />
      {/* Left wall */}
      <div
        style={{
          ...wallBase,
          top: WALL_BLEED,
          bottom: WALL_BLEED,
          left: 0,
          width: `${ROOM_DEPTH_PX}px`,
          transformOrigin: 'left center',
          transform: 'rotateY(90deg)',
          background: [
            gridLines('v'),
            'linear-gradient(to right, hsl(var(--background)) 0%, hsl(var(--muted) / 0.75) 55%, hsl(var(--muted) / 0.45) 100%)',
          ].join(', '),
          borderRight: '1px solid hsl(var(--border) / 0.35)',
        }}
      />
      {/* Right wall */}
      <div
        style={{
          ...wallBase,
          top: WALL_BLEED,
          bottom: WALL_BLEED,
          right: 0,
          width: `${ROOM_DEPTH_PX}px`,
          transformOrigin: 'right center',
          transform: 'rotateY(-90deg)',
          background: [
            gridLines('v'),
            'linear-gradient(to left, hsl(var(--background)) 0%, hsl(var(--muted) / 0.75) 55%, hsl(var(--muted) / 0.45) 100%)',
          ].join(', '),
          borderLeft: '1px solid hsl(var(--border) / 0.35)',
        }}
      />
      {/* Ceiling */}
      <div
        style={{
          ...wallBase,
          left: WALL_BLEED,
          right: WALL_BLEED,
          top: 0,
          height: `${ROOM_DEPTH_PX}px`,
          transformOrigin: 'center top',
          transform: 'rotateX(-90deg)',
          background: [
            gridLines('h'),
            'linear-gradient(to bottom, hsl(var(--background)) 0%, hsl(var(--muted) / 0.6) 60%, hsl(var(--muted) / 0.35) 100%)',
          ].join(', '),
          borderBottom: '1px solid hsl(var(--border) / 0.3)',
        }}
      />
      {/* Floor — slightly glossier than the ceiling, like a screen reflection */}
      <div
        style={{
          ...wallBase,
          left: WALL_BLEED,
          right: WALL_BLEED,
          bottom: 0,
          height: `${ROOM_DEPTH_PX}px`,
          transformOrigin: 'center bottom',
          transform: 'rotateX(90deg)',
          background: [
            `radial-gradient(ellipse 55% 70% at 50% 18%, hsl(var(--primary) / ${glow * 1.6}) 0%, transparent 65%)`,
            gridLines('h'),
            gridLines('v'),
            'linear-gradient(to top, hsl(var(--background)) 0%, hsl(var(--muted) / 0.8) 55%, hsl(var(--muted) / 0.5) 100%)',
          ].join(', '),
          borderTop: '1px solid hsl(var(--border) / 0.35)',
        }}
      />
    </div>
  );
}
