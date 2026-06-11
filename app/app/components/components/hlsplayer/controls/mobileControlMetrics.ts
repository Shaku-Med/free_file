import type { CSSProperties } from 'react';

export type MobileControlMetrics = {
  scale: number;
  btnPx: number;
  smallBtnPx: number;
  mainBtnPx: number;
  iconPx: number;
  mainIconPx: number;
  pillHeightPx: number;
  pillPadXPx: number;
  gapPx: number;
  topGapPx: number;
  padPx: number;
  fontPx: number;
  insetPx: number;
  seekTrackPx: number;
  seekHitPx: number;
  seekHandlePx: number;
  seekHandleInsetPx: number;
  toggleTrackWPx: number;
  toggleTrackHPx: number;
  toggleKnobPx: number;
  toggleIconPx: number;
  timeSepPx: number;
};

/** Scale mobile chrome from the player box — not the viewport. */
export function mobileControlMetrics(playerW: number, playerH: number): MobileControlMetrics {
  const w = playerW > 0 ? playerW : 360;
  const h = playerH > 0 ? playerH : 640;

  const scaleW = w / 360;
  const scaleH = h / 240;
  const narrowMul = w < 300 ? Math.max(0.82, w / 300) : 1;
  const scale = Math.max(0.5, Math.min(1, Math.min(scaleW, scaleH) * narrowMul));

  return {
    scale,
    btnPx: Math.max(28, Math.round(44 * scale)),
    smallBtnPx: Math.max(24, Math.round(36 * scale)),
    mainBtnPx: Math.max(40, Math.round(72 * scale)),
    iconPx: Math.max(13, Math.round(20 * scale)),
    mainIconPx: Math.max(18, Math.round(36 * scale)),
    pillHeightPx: Math.max(26, Math.round(44 * scale)),
    pillPadXPx: Math.max(4, Math.round(10 * scale)),
    gapPx: Math.max(4, Math.round(16 * scale)),
    topGapPx: Math.max(3, Math.round(8 * scale)),
    padPx: Math.max(6, Math.round(12 * scale)),
    fontPx: Math.max(8, Math.round(11 * scale)),
    insetPx: Math.max(6, Math.round(12 * scale)),
    seekTrackPx: Math.max(2, Math.round(3 * scale)),
    seekHitPx: Math.max(22, Math.round(36 * scale)),
    seekHandlePx: Math.max(10, Math.round(16 * scale)),
    seekHandleInsetPx: Math.max(4, Math.round(8 * scale)),
    toggleTrackWPx: Math.max(28, Math.round(44 * scale)),
    toggleTrackHPx: Math.max(14, Math.round(24 * scale)),
    toggleKnobPx: Math.max(12, Math.round(20 * scale)),
    toggleIconPx: Math.max(7, Math.round(10 * scale)),
    timeSepPx: Math.max(2, Math.round(4 * scale)),
  };
}

export function mobileControlStyleVars(m: MobileControlMetrics): CSSProperties {
  return {
    '--hls-ctrl-btn': `${m.btnPx}px`,
    '--hls-ctrl-small-btn': `${m.smallBtnPx}px`,
    '--hls-ctrl-main-btn': `${m.mainBtnPx}px`,
    '--hls-ctrl-icon': `${m.iconPx}px`,
    '--hls-ctrl-main-icon': `${m.mainIconPx}px`,
    '--hls-ctrl-pill-h': `${m.pillHeightPx}px`,
    '--hls-ctrl-pill-px': `${m.pillPadXPx}px`,
    '--hls-ctrl-gap': `${m.gapPx}px`,
    '--hls-ctrl-top-gap': `${m.topGapPx}px`,
    '--hls-ctrl-pad': `${m.padPx}px`,
    '--hls-ctrl-font': `${m.fontPx}px`,
    '--hls-ctrl-inset': `${m.insetPx}px`,
    '--hls-ctrl-seek-track': `${m.seekTrackPx}px`,
    '--hls-ctrl-seek-hit': `${m.seekHitPx}px`,
    '--hls-ctrl-seek-handle': `${m.seekHandlePx}px`,
    '--hls-ctrl-seek-handle-inset': `${m.seekHandleInsetPx}px`,
    '--hls-ctrl-toggle-w': `${m.toggleTrackWPx}px`,
    '--hls-ctrl-toggle-h': `${m.toggleTrackHPx}px`,
    '--hls-ctrl-toggle-knob': `${m.toggleKnobPx}px`,
    '--hls-ctrl-toggle-icon': `${m.toggleIconPx}px`,
    '--hls-ctrl-time-sep': `${m.timeSepPx}px`,
  } as CSSProperties;
}

export const mobileOverlayCircleBtn =
  'flex h-[var(--hls-ctrl-btn,2.75rem)] w-[var(--hls-ctrl-btn,2.75rem)] shrink-0 items-center justify-center rounded-full bg-black/50 text-white shadow-sm backdrop-blur-sm active:scale-95 transition-transform';

export const mobileOverlaySmallCircleBtn =
  'flex h-[var(--hls-ctrl-small-btn,2.25rem)] w-[var(--hls-ctrl-small-btn,2.25rem)] shrink-0 items-center justify-center rounded-full bg-black/50 text-white shadow-sm backdrop-blur-sm active:scale-95 transition-transform';

export const mobileOverlaySquareBtn =
  'flex h-[var(--hls-ctrl-small-btn,2.25rem)] w-[var(--hls-ctrl-small-btn,2.25rem)] shrink-0 items-center justify-center rounded-lg border border-white/20 bg-black/50 text-white shadow-sm backdrop-blur-sm active:bg-black/60';

export const mobileOverlayIcon =
  'h-[var(--hls-ctrl-icon,1.25rem)] w-[var(--hls-ctrl-icon,1.25rem)]';

export const mobileOverlayMainIcon =
  'h-[var(--hls-ctrl-main-icon,2.25rem)] w-[var(--hls-ctrl-main-icon,2.25rem)]';

export const mobileVolumePillShell =
  'flex shrink-0 items-center justify-center rounded-full bg-black/50 shadow-sm backdrop-blur-sm';

export const mobileTimePill =
  'flex min-w-0 max-w-full shrink cursor-default items-center justify-center rounded-full bg-black/50 font-medium tabular-nums leading-none text-white shadow-sm backdrop-blur-sm';

export const mobileAutoplayToggleTrack =
  'relative inline-flex shrink-0 rounded-full transition-colors duration-200 h-[var(--hls-ctrl-toggle-h,1.5rem)] w-[var(--hls-ctrl-toggle-w,2.75rem)]';

export const mobileAutoplayToggleKnob =
  'absolute top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full bg-white shadow transition-all duration-200 h-[var(--hls-ctrl-toggle-knob,1.25rem)] w-[var(--hls-ctrl-toggle-knob,1.25rem)]';

export const mobileAutoplayToggleIcon =
  'fill-neutral-900 text-neutral-900 h-[var(--hls-ctrl-toggle-icon,0.625rem)] w-[var(--hls-ctrl-toggle-icon,0.625rem)]';

export const mobilePillIconBtn =
  'rounded-lg text-white transition-colors hover:bg-white/10 p-[calc(var(--hls-ctrl-pill-px,0.5rem)*0.35)]';

export const mobilePillIcon =
  'h-[var(--hls-ctrl-icon,1.25rem)] w-[var(--hls-ctrl-icon,1.25rem)]';

export function mobilePillShellStyle(extra?: CSSProperties): CSSProperties {
  return {
    height: 'var(--hls-ctrl-pill-h, 2.75rem)',
    minHeight: 'var(--hls-ctrl-pill-h, 2.75rem)',
    ...extra,
  };
}

export function mobileTimePillStyle(): CSSProperties {
  return {
    ...mobilePillShellStyle(),
    fontSize: 'var(--hls-ctrl-font, 11px)',
    paddingLeft: 'var(--hls-ctrl-pill-px, 0.5rem)',
    paddingRight: 'var(--hls-ctrl-pill-px, 0.5rem)',
  };
}

export function mobileTimeSeparatorStyle(): CSSProperties {
  return {
    marginLeft: 'var(--hls-ctrl-time-sep, 0.25rem)',
    marginRight: 'var(--hls-ctrl-time-sep, 0.25rem)',
  };
}
