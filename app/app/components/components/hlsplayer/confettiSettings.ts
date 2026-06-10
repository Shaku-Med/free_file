export type ConfettiRuntimeConfig = {
  maxParticles: number;
  countMul: number;
  cooldownMul: number;
  spillTop: number;
  spillSide: number;
  spillBottom: number;
};

const BASE_SPILL = { top: 48, side: 40, bottom: 72 };

/** Map live audio tension (0–1) to particle budget + spill. Louder / punchier = more confetti. */
export function confettiRuntimeConfig(tension: number): ConfettiRuntimeConfig {
  const t = Math.min(1, Math.max(0, tension));
  const spreadMul = 0.72 + t * 0.48;
  return {
    maxParticles: Math.round(70 + t * 200),
    countMul: 0.4 + t * 1.15,
    cooldownMul: 1.3 - t * 0.4,
    spillTop: Math.round(BASE_SPILL.top * spreadMul),
    spillSide: Math.round(BASE_SPILL.side * spreadMul),
    spillBottom: Math.round(BASE_SPILL.bottom * spreadMul),
  };
}

/** Distance from player bottom to confetti spawn line (visualizer strip). */
export const CONFETTI_SPAWN_FROM_BOTTOM_PX = 42;
