import { useEffect, useRef } from 'react';
import { usePlayerContext } from '../PlayerContext';
import { stemEventIndexAt, type StemType } from '../audioStems';
import {
  ensureSharedGraph,
  resumeIfNeeded,
  setPannerActive,
  setPannerPosition,
  setTheaterActive,
  setTheaterWet,
} from '~/lib/audio/sharedAudioGraph';

/**
 * VR theater: a three.js space rendered in place of the flat video.
 *
 * The real <video> keeps playing but goes invisible (opacity 0  it still
 * owns clicks / fullscreen / layout, same trick as VideoKickBounce); a WebGL
 * canvas takes its spot showing:
 *
 *   - a big gently-curved screen wrapping toward you (VideoTexture)
 *   - a stretched upside-down reflection bleeding downward that fades out
 *     on its own alpha gradient (the "stretchy shadow")
 *   - TRANSPARENT background  the page (ambient glow, theater black)
 *     shows through around the floating screen
 *   - head parallax + DRAG to look (mouse & touch) with fling inertia,
 *     pinch / Ctrl+wheel / Safari-gesture zoom in to fullscreen-and-then-some
 *
 * Interaction safety: drags only ever start on the <video> surface itself,
 * never on buttons / seek bar / menus, and we never pointer-capture the
 * container  so every player control keeps working exactly as before.
 *
 * three.js is dynamically imported, so the library only downloads when the
 * user actually flips the toggle. Bails (and restores the video) when the
 * video element is portaled away to the mini player.
 */

const MAX_DPR = 1.75;
const PARALLAX_X = 1.15;
const PARALLAX_Y = 0.55;
const PARALLAX_DAMP = 3.2;
/** Drag-look: radians per CSS pixel, pitch clamp, and fling friction. */
const DRAG_SPEED = 0.0042;
const PITCH_MIN = -0.55;
const PITCH_MAX = 0.75;
const YAW_LIMIT = 1.25;
const INERTIA_FRICTION = 4.5;
/** Zoom bounds (fov degrees). 22° fills the viewport with screen and a bit more. */
const FOV_MIN = 22;
const FOV_MAX = 92;
const FOV_BASE = 68;
/** Pixels of movement after which a gesture counts as a drag, not a tap. */
const TAP_SLOP_PX = 8;

/** Theater seating: 3 rows (front → back) × 5 seats (left → right). */
const SEAT_ROWS = 3;
const SEAT_COLS = 5;
const SEAT_ROW_Z = [4.1, 6.0, 7.9];
const SEAT_ROW_Y = [0.12, 0.35, 0.62];
const SEAT_COL_X = [-2.6, -1.3, 0, 1.3, 2.6];
/** World z of the screen's visible face (cylinder center minus radius). */
const SCREEN_FACE_Z = -1.6;
const SCREEN_CENTER_Y = 1.45;

function parseSeat(seat: string): { row: number; col: number } {
  const m = /^(\d+)-(\d+)$/.exec(seat ?? '');
  const row = m ? Math.min(SEAT_ROWS - 1, Math.max(0, Number(m[1]))) : 1;
  const col = m ? Math.min(SEAT_COLS - 1, Math.max(0, Number(m[2]))) : 2;
  return { row, col };
}

function seatCameraPos(seat: string): { x: number; y: number; z: number } {
  const { row, col } = parseSeat(seat);
  return { x: SEAT_COL_X[col], y: SEAT_ROW_Y[row], z: SEAT_ROW_Z[row] };
}

/** Dance-mode handoff: when the visualizer bounce is on, the 3D SCREEN bounces. */
const VR_BOUNCE_IMPULSE: Record<StemType, number> = {
  kick: 3.0,
  bass: 1.8,
  snare: 1.2,
  hihat: 0.7,
  other: 0.9,
};
const VR_BOUNCE_STIFFNESS = 170;
const VR_BOUNCE_DAMPING = 7.5;
const VR_ROT_STIFFNESS = 130;
const VR_ROT_DAMPING = 6.5;
const VR_MAX_SCALE = 0.09;
const VR_MAX_ROT = (2.2 * Math.PI) / 180;

type Spring = { disp: number; vel: number };

function springStep(s: Spring, dt: number, stiffness: number, damping: number): void {
  s.vel += -s.disp * stiffness * dt;
  s.vel *= Math.exp(-damping * dt);
  s.disp += s.vel * dt;
}

export default function VRTheaterOverlay() {
  const hostRef = useRef<HTMLDivElement>(null);
  const {
    videoRef,
    containerRef,
    vrTheater,
    isReel,
    vrSeat,
    vrSoundSystem,
    file,
    state,
    audioStems,
    audioVisualizer,
    videoBounce,
    videoBounceIntensity,
    videoBounceInstruments,
  } = usePlayerContext();

  const enabled = vrTheater && !isReel;
  /** Scene is rebuilt per video  navigating watch→watch must never stack two rooms. */
  const fileKey = file?.unique_id ?? file?.id ?? '';

  /** The render loop reads the seat live  picking one glides the camera over. */
  const seatRef = useRef(vrSeat);
  seatRef.current = vrSeat;

  // Dance-mode handoff (live refs so the loop never restarts).
  const stemsRef = useRef(audioStems);
  stemsRef.current = audioStems;
  const bounceOnRef = useRef(false);
  bounceOnRef.current = audioVisualizer && videoBounce && audioStems != null;
  const bounceIntensityRef = useRef(videoBounceIntensity);
  bounceIntensityRef.current = videoBounceIntensity;
  const bounceInstrumentsRef = useRef(videoBounceInstruments);
  bounceInstrumentsRef.current = videoBounceInstruments;
  const playingRef = useRef(false);
  playingRef.current = state.isPlaying;

  /** Render loop reads this live: when on, the panner tracks the camera every frame. */
  const soundOnRef = useRef(false);
  soundOnRef.current = vrSoundSystem;

  // Theater sound system on the SHARED per-video audio graph (one
  // MediaElementSource per element). This effect only flips the stages on
  // and off  the actual positions follow the camera live in the render
  // loop, so dragging / zooming moves the sound with your head.
  useEffect(() => {
    if (!enabled || !vrSoundSystem) return;
    const video = videoRef.current;
    if (!video) return;

    let active = true;
    let wired = false;
    // CRITICAL ordering: routing audio through a SUSPENDED AudioContext
    // silences the video entirely ("sound system on = sound gone"). So we
    // resume FIRST and only wire the stages once the context is running
    // retried on every user gesture, like useVideoAnalyser does, because
    // browsers may refuse resume() outside one.
    const apply = () => {
      if (!active || wired) return;
      const v = videoRef.current;
      if (!v) return;
      const graph = ensureSharedGraph(v);
      if (!graph) return; // metadata not ready — retries below
      void resumeIfNeeded(graph.ctx).then(() => {
        if (!active || wired) return;
        if (graph.ctx.state !== 'running') return;
        wired = true;
        setTheaterActive(graph, true);
        setPannerActive(graph, true);
      });
    };
    apply();
    const gestureOpts: AddEventListenerOptions = { capture: true, passive: true };
    document.addEventListener('pointerdown', apply, gestureOpts);
    document.addEventListener('touchend', apply, gestureOpts);
    document.addEventListener('click', apply, gestureOpts);
    video.addEventListener('loadedmetadata', apply);
    video.addEventListener('play', apply);
    return () => {
      active = false;
      document.removeEventListener('pointerdown', apply, gestureOpts);
      document.removeEventListener('touchend', apply, gestureOpts);
      document.removeEventListener('click', apply, gestureOpts);
      video.removeEventListener('loadedmetadata', apply);
      video.removeEventListener('play', apply);
      const graph = ensureSharedGraph(video);
      if (graph) {
        setTheaterActive(graph, false);
        // The 8D spatial feature re-asserts the panner itself if it's on.
        setPannerActive(graph, false);
        setPannerPosition(graph, 0, 0, -1, 0);
      }
    };
  }, [enabled, vrSoundSystem, videoRef]);

  useEffect(() => {
    if (!enabled) return;
    const host = hostRef.current;
    const container = containerRef.current;
    if (!host || !container) return;

    let disposed = false;
    let cleanup: (() => void) | null = null;

    void import('three').then((THREE) => {
      if (disposed || !hostRef.current) return;

      const video = videoRef.current;
      if (!video) return;

      // Transparent canvas: the page's own ambience shows through around the screen.
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setClearColor(0x000000, 0);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.display = 'block';
      host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(FOV_BASE, 1, 0.1, 60);
      // Camera lives at the picked seat; eased per-frame so seat changes glide.
      const startSeat = seatCameraPos(seatRef.current);
      let camX = startSeat.x;
      let camY = startSeat.y;
      let camZ = startSeat.z;
      camera.position.set(camX, camY, camZ);

      const videoTexture = new THREE.VideoTexture(video);
      videoTexture.colorSpace = THREE.SRGBColorSpace;
      videoTexture.minFilter = THREE.LinearFilter;
      videoTexture.magFilter = THREE.LinearFilter;

      // ── Curved screen ───────────────────────────────────────────────
      // Cylinder segment facing the camera; wraps slightly around you.
      const SCREEN_RADIUS = 7.5;
      const SCREEN_ARC = Math.PI / 2.9;
      const screenHeight = 3.4;
      const screenY = 1.45;
      const screenGeo = new THREE.CylinderGeometry(
        SCREEN_RADIUS,
        SCREEN_RADIUS,
        screenHeight,
        48,
        1,
        true,
        Math.PI - SCREEN_ARC / 2,
        SCREEN_ARC,
      );
      // Inside face + un-mirror the texture.
      screenGeo.scale(-1, 1, 1);
      const screenMat = new THREE.MeshBasicMaterial({ map: videoTexture, toneMapped: false });
      const screen = new THREE.Mesh(screenGeo, screenMat);
      screen.position.set(0, screenY, SCREEN_RADIUS - 1.6);
      scene.add(screen);

      // ── Stretchy reflection ─────────────────────────────────────────
      // Same curve flipped upside down and stretched taller; its OWN alpha
      // gradient fades it out, so no dark overlay is needed on the
      // transparent background.
      const reflGeo = screenGeo.clone();
      const reflTexture = videoTexture.clone();
      reflTexture.wrapT = THREE.ClampToEdgeWrapping;

      const alphaCanvas = document.createElement('canvas');
      alphaCanvas.width = 2;
      alphaCanvas.height = 128;
      const alphaCtx = alphaCanvas.getContext('2d');
      if (alphaCtx) {
        // Canvas y=0 (texture v=1) is the reflection's far end after the
        // mirror flip  fade from invisible there to brightest at the seam.
        const g = alphaCtx.createLinearGradient(0, 0, 0, 128);
        g.addColorStop(0, '#000');
        g.addColorStop(0.45, '#1a1a1a');
        g.addColorStop(1, '#fff');
        alphaCtx.fillStyle = g;
        alphaCtx.fillRect(0, 0, 2, 128);
      }
      const reflAlpha = new THREE.CanvasTexture(alphaCanvas);

      const reflMat = new THREE.MeshBasicMaterial({
        map: reflTexture,
        alphaMap: reflAlpha,
        transparent: true,
        opacity: 0.22,
        toneMapped: false,
        depthWrite: false,
      });
      const reflection = new THREE.Mesh(reflGeo, reflMat);
      reflection.scale.y = -1.85; // mirrored + stretched = the "stretchy shadow"
      reflection.position.set(
        0,
        screenY - screenHeight / 2 - (screenHeight * 1.85) / 2,
        SCREEN_RADIUS - 1.6,
      );
      scene.add(reflection);

      // ── Look controls: hover parallax + DRAG to look (mouse & touch),
      //    fling inertia, and pinch / Ctrl+wheel / gesture zoom ─────────
      let targetX = 0;
      let targetY = 0;
      let lookX = 0;
      let lookY = 0;

      let yaw = 0;
      let pitch = 0;
      let yawVel = 0;
      let pitchVel = 0;
      let targetFov = FOV_BASE;

      // Active pointers (id → last position) — 1 = drag-look, 2 = pinch.
      const pointers = new Map<number, { x: number; y: number }>();
      let dragDistance = 0;
      let suppressNextClick = false;
      let suppressTimer: number | null = null;
      let lastMoveTs = 0;
      let pinchStartDist = 0;
      let pinchStartFov = FOV_BASE;

      const clampPitch = (v: number) => Math.max(PITCH_MIN, Math.min(PITCH_MAX, v));
      const clampYaw = (v: number) => Math.max(-YAW_LIMIT, Math.min(YAW_LIMIT, v));
      const clampFov = (v: number) => Math.max(FOV_MIN, Math.min(FOV_MAX, v));

      const pinchDist = () => {
        const pts = [...pointers.values()];
        if (pts.length < 2) return 0;
        return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      };

      const onPointerDown = (e: PointerEvent) => {
        // Drags only start on the bare video surface — buttons, seek bar,
        // menus and every other control keep their events untouched.
        if (e.target !== video) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        dragDistance = 0;
        yawVel = 0;
        pitchVel = 0;
        if (pointers.size === 2) {
          pinchStartDist = pinchDist();
          pinchStartFov = targetFov;
        }
      };

      // Window-level so a drag keeps tracking outside the player (no pointer
      // capture — capturing on the container stole events from the controls).
      const onWindowPointerMove = (e: PointerEvent) => {
        const tracked = pointers.get(e.pointerId);
        if (!tracked) return;

        const dx = e.clientX - tracked.x;
        const dy = e.clientY - tracked.y;
        tracked.x = e.clientX;
        tracked.y = e.clientY;
        dragDistance += Math.abs(dx) + Math.abs(dy);

        if (pointers.size >= 2) {
          const d = pinchDist();
          if (pinchStartDist > 0 && d > 0) {
            targetFov = clampFov(pinchStartFov * (pinchStartDist / d));
          }
          return;
        }

        // Single-pointer drag: grab-the-world look (drag right = look left).
        const now = performance.now();
        const dt = lastMoveTs > 0 ? Math.max(1, now - lastMoveTs) / 1000 : 1 / 60;
        lastMoveTs = now;
        const dYaw = -dx * DRAG_SPEED;
        const dPitch = dy * DRAG_SPEED;
        yaw = clampYaw(yaw + dYaw);
        pitch = clampPitch(pitch + dPitch);
        yawVel = dYaw / dt;
        pitchVel = dPitch / dt;
      };

      const onWindowPointerEnd = (e: PointerEvent) => {
        if (!pointers.delete(e.pointerId)) return;
        if (pointers.size < 2) pinchStartDist = 0;
        lastMoveTs = 0;
        if (dragDistance > TAP_SLOP_PX) {
          // The click that follows this release must not toggle play/pause.
          suppressNextClick = true;
          if (suppressTimer != null) window.clearTimeout(suppressTimer);
          suppressTimer = window.setTimeout(() => {
            suppressNextClick = false;
          }, 300);
        }
      };

      const suppressClickAfterDrag = (e: MouseEvent) => {
        if (suppressNextClick) {
          e.preventDefault();
          e.stopPropagation();
          suppressNextClick = false;
        }
      };

      // Ctrl+wheel zoom. Trackpad pinches in Chrome/Edge/Firefox arrive as
      // wheel events with ctrlKey=true, so this covers laptop pinch too.
      const onWheel = (e: WheelEvent) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const step = e.deltaMode === 1 ? e.deltaY * 1.6 : e.deltaY * 0.045;
        targetFov = clampFov(targetFov + step);
      };

      // Safari (desktop + iPad trackpad) reports pinches via gesture events.
      let gestureBaseFov = FOV_BASE;
      const onGestureStart = (e: Event) => {
        e.preventDefault();
        gestureBaseFov = targetFov;
      };
      const onGestureChange = (e: Event) => {
        const scale = (e as Event & { scale?: number }).scale;
        if (typeof scale !== 'number' || scale <= 0) return;
        e.preventDefault();
        targetFov = clampFov(gestureBaseFov / scale);
      };

      // Android fires this without a permission prompt; iOS would need a
      // gesture-bound request, so it quietly falls back to the idle sway.
      const onOrientation = (e: DeviceOrientationEvent) => {
        if (e.gamma == null || e.beta == null) return;
        targetX = Math.max(-1, Math.min(1, e.gamma / 28));
        targetY = Math.max(-1, Math.min(1, (e.beta - 45) / 32));
      };

      // Touch drags on the video must reach us, not scroll the page.
      const prevTouchAction = video.style.touchAction;
      video.style.touchAction = 'none';

      container.addEventListener('pointerdown', onPointerDown, { passive: true });
      container.addEventListener('click', suppressClickAfterDrag, true);
      container.addEventListener('wheel', onWheel, { passive: false });
      container.addEventListener('gesturestart', onGestureStart as EventListener, { passive: false });
      container.addEventListener('gesturechange', onGestureChange as EventListener, { passive: false });
      window.addEventListener('pointermove', onWindowPointerMove, { passive: true });
      window.addEventListener('pointerup', onWindowPointerEnd, { passive: true });
      window.addEventListener('pointercancel', onWindowPointerEnd, { passive: true });
      window.addEventListener('deviceorientation', onOrientation);

      // ── Sizing ──────────────────────────────────────────────────────
      const resize = () => {
        const w = host.clientWidth;
        const h = host.clientHeight;
        if (w < 8 || h < 8) return;
        renderer.setPixelRatio(Math.min(MAX_DPR, window.devicePixelRatio || 1));
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(host);

      // ── Hidden-video bookkeeping ────────────────────────────────────
      let hiddenVideo: HTMLVideoElement | null = null;
      const hideVideo = (v: HTMLVideoElement) => {
        if (hiddenVideo !== v) {
          v.style.opacity = '0';
          hiddenVideo = v;
        }
      };
      const restoreVideo = () => {
        if (hiddenVideo) {
          hiddenVideo.style.opacity = '';
          hiddenVideo = null;
        }
      };

      // ── Dance-mode springs (visualizer bounce drives the 3D screen) ──
      const bScale: Spring = { disp: 0, vel: 0 };
      const bRot: Spring = { disp: 0, vel: 0 };
      let bRotSign = 1;
      let bEvIdx = 0;
      let bLastTime = 0;

      const consumeBeats = (v: HTMLVideoElement) => {
        const stems = stemsRef.current;
        if (!stems || !bounceOnRef.current || !playingRef.current) return;
        const t = v.currentTime;
        const evs = stems.events;
        if (t < bLastTime - 0.05 || t - bLastTime > 1.5) {
          bEvIdx = stemEventIndexAt(evs, t);
        }
        while (bEvIdx < evs.length && evs[bEvIdx]!.t <= t) {
          const e = evs[bEvIdx]!;
          bEvIdx++;
          if (t - e.t > 0.2) continue;
          if (!bounceInstrumentsRef.current[e.type]) continue;
          const impulse = VR_BOUNCE_IMPULSE[e.type] * e.s * bounceIntensityRef.current;
          bScale.vel += impulse;
          bRotSign = -bRotSign;
          bRot.vel += bRotSign * impulse * 0.8;
        }
        bLastTime = t;
      };

      // ── Render loop ─────────────────────────────────────────────────
      let rafId: number | null = null;
      let lastNow = 0;
      let lastAudioSync = 0;
      const screenInCamSpace = new THREE.Vector3();
      const tick = (now: number) => {
        rafId = requestAnimationFrame(tick);
        const dt = Math.min(0.05, lastNow > 0 ? (now - lastNow) / 1000 : 1 / 60);
        lastNow = now;
        if (document.visibilityState !== 'visible') return;

        const v = videoRef.current;
        // Mini-player portal moved the video out, or navigation swapped the
        // element under us (the rebuild keyed on the file id is coming)
        // hand the pixels back and stop painting stale frames.
        if (!v || v !== video || !container.contains(v)) {
          restoreVideo();
          return;
        }
        if (v.readyState >= 2) hideVideo(v);

        // Beat bounce: the 3D screen (and its reflection) dances.
        consumeBeats(v);
        springStep(bScale, dt, VR_BOUNCE_STIFFNESS, VR_BOUNCE_DAMPING);
        springStep(bRot, dt, VR_ROT_STIFFNESS, VR_ROT_DAMPING);
        const pop = Math.max(-0.05, Math.min(1, bScale.disp));
        const rotZ = Math.max(-1, Math.min(1, bRot.disp)) * VR_MAX_ROT;
        screen.scale.set(1 + pop * VR_MAX_SCALE * 0.7, 1 + pop * VR_MAX_SCALE, 1 + pop * VR_MAX_SCALE * 0.7);
        screen.rotation.z = rotZ;
        reflection.scale.x = screen.scale.x;
        reflection.scale.y = -1.85 * (1 + pop * VR_MAX_SCALE);
        reflection.rotation.z = -rotZ;

        // Smooth-damped parallax + a slow idle sway so it always breathes.
        const t = now / 1000;
        const swayX = Math.sin(t * 0.31) * 0.06;
        const swayY = Math.cos(t * 0.23) * 0.03;
        const k = 1 - Math.exp(-PARALLAX_DAMP * dt);
        lookX += (targetX - lookX) * k;
        lookY += (targetY - lookY) * k;

        // Fling inertia: released drags keep turning, friction brings it home.
        if (pointers.size === 0 && (yawVel !== 0 || pitchVel !== 0)) {
          yaw = clampYaw(yaw + yawVel * dt);
          pitch = clampPitch(pitch + pitchVel * dt);
          const decay = Math.exp(-INERTIA_FRICTION * dt);
          yawVel *= decay;
          pitchVel *= decay;
          if (Math.abs(yawVel) < 0.01 && Math.abs(pitchVel) < 0.01) {
            yawVel = 0;
            pitchVel = 0;
          }
        }

        // Zoom eases instead of snapping.
        camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-6 * dt));
        camera.updateProjectionMatrix();

        // Glide toward the picked seat (walking over, not teleporting).
        const seatPos = seatCameraPos(seatRef.current);
        const kSeat = 1 - Math.exp(-2.2 * dt);
        camX += (seatPos.x - camX) * kSeat;
        camY += (seatPos.y - camY) * kSeat;
        camZ += (seatPos.z - camZ) * kSeat;

        camera.position.x = camX + (lookX + swayX) * PARALLAX_X;
        camera.position.y = camY - (lookY + swayY) * PARALLAX_Y;
        camera.position.z = camZ;

        // Base gaze always faces the screen FROM this seat (side seats look
        // inward, like real theater chairs); drag turns relative to that.
        const dxs = -camX;
        const dzs = SCREEN_FACE_Z - camZ;
        const yawBase = Math.atan2(dxs, -dzs);
        const pitchBase = Math.atan2(SCREEN_CENTER_Y - 0.2 - camY, Math.hypot(dxs, dzs));
        const gazeYaw = yawBase + yaw;
        const gazePitch = pitchBase + pitch;
        const dirX = Math.sin(gazeYaw) * Math.cos(gazePitch);
        const dirY = Math.sin(gazePitch);
        const dirZ = -Math.cos(gazeYaw) * Math.cos(gazePitch);
        camera.lookAt(
          camera.position.x + dirX,
          camera.position.y + dirY,
          camera.position.z + dirZ,
        );

        // Sound system follows your head: the screen's position in CAMERA
        // space maps straight onto the WebAudio listener (both face -Z), so
        // turning away pans the sound, zooming pulls it closer, and distance
        // feeds the room reverb. Throttled — audio params don't need 60fps.
        if (soundOnRef.current && now - lastAudioSync > 120) {
          lastAudioSync = now;
          const graph = ensureSharedGraph(video);
          if (graph && graph.ctx.state === 'running' && graph.pannerActive) {
            camera.updateMatrixWorld();
            screenInCamSpace.set(0, SCREEN_CENTER_Y, SCREEN_FACE_Z);
            camera.worldToLocal(screenInCamSpace);
            // Zoomed in (small fov) = sitting closer = sound nearer + drier.
            const zoomScale = camera.fov / FOV_BASE;
            const px = screenInCamSpace.x * 0.4 * zoomScale;
            const py = screenInCamSpace.y * 0.3 * zoomScale;
            const pz = screenInCamSpace.z * 0.4 * zoomScale;
            setPannerPosition(graph, px, py, pz, 0.12);
            const dist = Math.hypot(px, py, pz);
            setTheaterWet(graph, 0.1 + Math.min(0.32, dist * 0.075), 0.15);
          }
        }

        renderer.render(scene, camera);
      };
      rafId = requestAnimationFrame(tick);

      cleanup = () => {
        if (rafId != null) cancelAnimationFrame(rafId);
        if (suppressTimer != null) window.clearTimeout(suppressTimer);
        ro.disconnect();
        container.removeEventListener('pointerdown', onPointerDown);
        container.removeEventListener('click', suppressClickAfterDrag, true);
        container.removeEventListener('wheel', onWheel);
        container.removeEventListener('gesturestart', onGestureStart as EventListener);
        container.removeEventListener('gesturechange', onGestureChange as EventListener);
        window.removeEventListener('pointermove', onWindowPointerMove);
        window.removeEventListener('pointerup', onWindowPointerEnd);
        window.removeEventListener('pointercancel', onWindowPointerEnd);
        window.removeEventListener('deviceorientation', onOrientation);
        video.style.touchAction = prevTouchAction;
        restoreVideo();
        scene.traverse((obj) => {
          const mesh = obj as { geometry?: { dispose(): void }; material?: { dispose(): void } };
          mesh.geometry?.dispose?.();
          mesh.material?.dispose?.();
        });
        videoTexture.dispose();
        reflTexture.dispose();
        reflAlpha.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    });

    return () => {
      disposed = true;
      cleanup?.();
      cleanup = null;
    };
    // fileKey: navigating watch→watch rebuilds the room for the new video —
    // the old scene/canvas is fully disposed first, so rooms can never stack.
  }, [enabled, fileKey, videoRef, containerRef]);

  if (!enabled) return null;

  // Same screen shell as <video>; listeners live on the container, so the
  // canvas host never eats clicks meant for the video / controls.
  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0 z-[2] overflow-hidden" />
  );
}
