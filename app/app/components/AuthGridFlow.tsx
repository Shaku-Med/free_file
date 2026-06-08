import { cn } from '~/lib/utils';

const W = 1200;
const H = 900;
const GRID = 75;

// Closed orthogonal loops snapped to the grid. The glowing streak rides each
// loop forever; closing it (Z) means no jump on repeat.
const ROUTES = [
  { d: 'M150 150 H600 V450 H825 V750 H300 V525 H150 Z', dur: 16, streak: 18 },
  { d: 'M750 150 H1050 V525 H900 V300 H750 Z', dur: 12, streak: 22 },
  { d: 'M300 825 H1050 V600 H825 V750 H450 V600 H300 Z', dur: 20, streak: 16 },
  { d: 'M150 675 H375 V375 H600 V225 H150 Z', dur: 14, streak: 20 },
] as const;

const ORBS = [
  { cx: 240, cy: 240, r: 320, dur: 24, x: [240, 420, 240], y: [240, 180, 240] },
  { cx: 980, cy: 700, r: 300, dur: 28, x: [980, 760, 980], y: [700, 560, 700] },
] as const;

const verticals = Array.from({ length: Math.floor(W / GRID) + 1 }, (_, i) => i * GRID);
const horizontals = Array.from({ length: Math.floor(H / GRID) + 1 }, (_, i) => i * GRID);

export function AuthGridFlow({ className }: { className?: string }) {
  return (
    <div className={cn('absolute inset-0 overflow-hidden', className)} aria-hidden>
      <svg
        className="h-full w-full"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <radialGradient id="agf-orb" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.16" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
          </radialGradient>
          <filter id="agf-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {ORBS.map((o, i) => (
          <circle key={`orb-${i}`} cx={o.cx} cy={o.cy} r={o.r} fill="url(#agf-orb)">
            <animate attributeName="cx" values={o.x.join(';')} dur={`${o.dur}s`} repeatCount="indefinite" />
            <animate attributeName="cy" values={o.y.join(';')} dur={`${o.dur}s`} repeatCount="indefinite" />
          </circle>
        ))}

        <g stroke="hsl(var(--foreground))" strokeWidth="1" opacity="0.18">
          {verticals.map((x) => (
            <line key={`v-${x}`} x1={x} y1={0} x2={x} y2={H} />
          ))}
          {horizontals.map((y) => (
            <line key={`h-${y}`} x1={0} y1={y} x2={W} y2={y} />
          ))}
        </g>

        {ROUTES.map((r, i) => (
          <g key={`route-${i}`}>
            <path d={r.d} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" opacity="0.2" />
            <path
              d={r.d}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="4"
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray={`${r.streak} 100`}
              filter="url(#agf-glow)"
            >
              <animate attributeName="stroke-dashoffset" from="100" to="0" dur={`${r.dur}s`} repeatCount="indefinite" />
            </path>
          </g>
        ))}
      </svg>
    </div>
  );
}

export default AuthGridFlow;
