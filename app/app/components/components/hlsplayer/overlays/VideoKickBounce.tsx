import { useEffect, useRef } from 'react';
import { usePlayerContext } from '../PlayerContext';
import { stemEventIndexAt, type StemType } from '../audioStems';

/**
 * Dance mode v2: canvas mirror bounce.
 *
 * The real <video> keeps playing but turns invisible (opacity 0 — it still
 * owns clicks, fullscreen and layout); a canvas painted with its frames takes
 * its place and THAT gets the motion. Drawing pixels ourselves means the
 * bounce can be heavy: vertical-biased squash-and-stretch, alternating
 * rotation wobble, and a camera-shake rattle on every kick — none of which a
 * CSS scale on the element could do without showing gaps.
 *
 * Springs everywhere = momentum: hits shove velocity, motion overshoots and
 * settles. The groove accumulator makes a driving beat hit harder over time.
 *
 * Bails (and restores the video) in tilt mode and when the video element is
 * portaled away to the mini player — the canvas only mirrors what lives in
 * this container.
 */

const MAX_EXTRA_SCALE = 0.22;
const SQUASH_RATIO = 0.72; // horizontal pop is 72% of vertical — feels heavy
const MAX_ROTATE_RAD = (2.6 * Math.PI) / 180;
const STIFFNESS = 175;
const DAMPING = 7.5;
/** Per-stem impulse strength; user picks which of these are live. */
const STEM_IMPULSE: Record<StemType, number> = {
  kick: 3.6,
  bass: 2.1,
  snare: 1.4,
  hihat: 0.8,
  other: 1.0,
};
/** Rotation sway: softer damping than scale so the left/right dance lingers. */
const ROT_STIFFNESS = 130;
const ROT_DAMPING = 6.5;
const ROT_IMPULSE_RATIO = 0.85;
/** Camera shake: stiffer + harder damped than the scale spring = fast rattle. */
const SHAKE_STIFFNESS = 320;
const SHAKE_DAMPING = 14;
const SHAKE_KICK_PX = 13;
/** Vibration: high-frequency random jitter envelope on top of the shake —
 * hits pump it, it buzzes off over ~a quarter second. THE noticeable part. */
const VIB_PUMP_PX = 5.5;
const VIB_MAX_PX = 11;
const VIB_DECAY_PER_S = 26;
const GROOVE_GAIN = 0.35;
const GROOVE_DECAY_PER_S = 0.85;
const GROOVE_MAX_BOOST = 0.6;
const FRESH_WINDOW_S = 0.2;
const SEEK_RESYNC_S = 1.5;
const MAX_DPR = 1.5;

type Spring = { disp: number; vel: number };

function springStep(s: Spring, dt: number, stiffness: number, damping: number): void {
  s.vel += -s.disp * stiffness * dt;
  s.vel *= Math.exp(-damping * dt);
  s.disp += s.vel * dt;
}

export default function VideoKickBounce() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const {
    videoRef,
    containerRef,
    audioStems,
    audioVisualizer,
    videoBounce,
    videoBounceIntensity,
    videoBounceInstruments,
    tiltMode,
    state,
  } = usePlayerContext();

  const playingRef = useRef(false);
  playingRef.current = state.isPlaying && !state.isPaused;
  const stemsRef = useRef(audioStems);
  stemsRef.current = audioStems;
  const tiltRef = useRef(tiltMode);
  tiltRef.current = tiltMode;
  const intensityRef = useRef(videoBounceIntensity);
  intensityRef.current = videoBounceIntensity;
  const instrumentsRef = useRef(videoBounceInstruments);
  instrumentsRef.current = videoBounceInstruments;

  const enabled = audioVisualizer && videoBounce && audioStems != null;

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let rafId: number | null = null;
    const scaleSpring: Spring = { disp: 0, vel: 0 };
    const rotSpring: Spring = { disp: 0, vel: 0 };
    const shakeX: Spring = { disp: 0, vel: 0 };
    const shakeY: Spring = { disp: 0, vel: 0 };
    let vib = 0;
    let rotSign = 1;
    let groove = 0;
    let lastNow = 0;
    let idx = 0;
    let lastTime = 0;
    let hiddenVideo: HTMLVideoElement | null = null;

    const hideVideo = (video: HTMLVideoElement) => {
      if (hiddenVideo !== video) {
        video.style.opacity = '0';
        hiddenVideo = video;
      }
    };
    const restoreVideo = () => {
      if (hiddenVideo) {
        hiddenVideo.style.opacity = '';
        hiddenVideo = null;
      }
    };

    const consumeBeatEvents = (video: HTMLVideoElement) => {
      const stems = stemsRef.current;
      if (!stems || !playingRef.current) return;
      const t = video.currentTime;
      const evs = stems.events;
      if (t < lastTime - 0.05 || t - lastTime > SEEK_RESYNC_S) {
        idx = stemEventIndexAt(evs, t);
      }
      while (idx < evs.length && evs[idx]!.t <= t) {
        const e = evs[idx]!;
        idx++;
        if (t - e.t > FRESH_WINDOW_S) continue;
        if (!instrumentsRef.current[e.type]) continue;

        const boost = 1 + Math.min(GROOVE_MAX_BOOST, groove);
        const impulse = STEM_IMPULSE[e.type] * e.s * boost * intensityRef.current;
        scaleSpring.vel += impulse;
        rotSign = -rotSign;
        rotSpring.vel += rotSign * impulse * ROT_IMPULSE_RATIO;
        const shakeAngle = Math.random() * Math.PI * 2;
        shakeX.vel += Math.cos(shakeAngle) * impulse * SHAKE_KICK_PX;
        shakeY.vel += Math.sin(shakeAngle) * impulse * SHAKE_KICK_PX;
        vib = Math.min(VIB_MAX_PX, vib + impulse * VIB_PUMP_PX);
        groove = Math.min(2, groove + GROOVE_GAIN * e.s);
      }
      lastTime = t;
    };

    const drawFrame = (video: HTMLVideoElement) => {
      const host = containerRef.current;
      if (!host) return;
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w < 8 || h < 8 || video.videoWidth === 0) return;

      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      const pw = Math.floor(w * dpr);
      const ph = Math.floor(h * dpr);
      if (canvas.width !== pw) canvas.width = pw;
      if (canvas.height !== ph) canvas.height = ph;

      // object-contain rect, same as the hidden video renders.
      const fit = Math.min(w / video.videoWidth, h / video.videoHeight);
      const dw = video.videoWidth * fit;
      const dh = video.videoHeight * fit;

      const pop = Math.max(-0.05, Math.min(1, scaleSpring.disp));
      const sy = 1 + pop * MAX_EXTRA_SCALE;
      const sx = 1 + pop * MAX_EXTRA_SCALE * SQUASH_RATIO;
      const rot = Math.max(-1, Math.min(1, rotSpring.disp)) * MAX_ROTATE_RAD;

      // Vibration: fresh random jitter EVERY frame while the envelope is hot —
      // reads as a buzz, distinct from the directional spring shake.
      const jx = (Math.random() - 0.5) * 2 * vib;
      const jy = (Math.random() - 0.5) * 2 * vib;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(w / 2 + shakeX.disp + jx, h / 2 + shakeY.disp + jy);
      ctx.rotate(rot);
      ctx.scale(sx, sy);
      try {
        ctx.drawImage(video, -dw / 2, -dh / 2, dw, dh);
      } catch {
        return; // decoder not ready for this frame; keep the previous paint
      }
      hideVideo(video);
    };

    const tick = (now: number) => {
      rafId = requestAnimationFrame(tick);
      const dt = Math.min(0.05, lastNow > 0 ? (now - lastNow) / 1000 : 1 / 60);
      lastNow = now;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

      const video = videoRef.current;
      const host = containerRef.current;
      // Tilt mode and the mini-player portal own the video's presentation —
      // hand the pixels back and idle until the video is ours again.
      if (!video || !host || tiltRef.current || !host.contains(video) || video.readyState < 2) {
        restoreVideo();
        return;
      }

      groove = Math.max(0, groove - GROOVE_DECAY_PER_S * dt);
      vib = Math.max(0, vib - VIB_DECAY_PER_S * dt);
      consumeBeatEvents(video);

      springStep(scaleSpring, dt, STIFFNESS, DAMPING);
      springStep(rotSpring, dt, ROT_STIFFNESS, ROT_DAMPING);
      springStep(shakeX, dt, SHAKE_STIFFNESS, SHAKE_DAMPING);
      springStep(shakeY, dt, SHAKE_STIFFNESS, SHAKE_DAMPING);

      drawFrame(video);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      restoreVideo();
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [enabled, videoRef, containerRef, audioStems]);

  if (!enabled) return null;

  // pointer-events-none: clicks fall through to the invisible video, so
  // tap-to-pause / double-tap keep working untouched.
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[2] h-full w-full"
    />
  );
}
