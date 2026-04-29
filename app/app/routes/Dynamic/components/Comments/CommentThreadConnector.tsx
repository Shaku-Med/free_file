import { cn } from "~/lib/utils";

/** Stroke width — YouTube-like thin rails; still visible on OLED. */
const STROKE = 1.35;
/** Horizontal width of one thread column (indent per nesting level). */
export const COMMENT_THREAD_STEP_PX = 28;
/** @deprecated Use commentThreadGutterWidthPx(level) — kept for imports expecting a single step. */
export const COMMENT_THREAD_GUTTER_PX = COMMENT_THREAD_STEP_PX;

/** Matches `Avatar` in CommentItem (`h-9 w-9`) so the elbow meets the avatar center. */
export const COMMENT_AVATAR_SIZE_PX = 36;
const JOIN_Y = COMMENT_AVATAR_SIZE_PX / 2;

export function commentThreadGutterWidthPx(level: number): number {
  return Math.max(0, level) * COMMENT_THREAD_STEP_PX;
}

/** How far above the row we draw so the spine meets the parent’s connector. */
const EXTEND_TOP = 72;
/** Spine continues below the avatar row into the gap before the next sibling. */
const Y_BELOW = 32;
/** Rounded “└” elbow radius (YouTube-style bend toward the avatar). */
const ELBOW_R = 6;

type CommentThreadConnectorProps = {
  level: number;
  /** Length must be `level - 1`: column `i` draws a full vertical rail if true (ancestor had a younger sibling). */
  threadPrefix: boolean[];
  isLastInThread: boolean;
  className?: string;
};

function normalizePrefix(threadPrefix: boolean[], level: number): boolean[] {
  const need = Math.max(0, level - 1);
  const out = threadPrefix.slice(0, need);
  while (out.length < need) out.push(false);
  return out;
}

/** Sharp file-tree paths: prefix rails + last-column rounded └ + horizontal to avatar. */
function buildTreePaths(
  level: number,
  step: number,
  prefix: boolean[],
  isLast: boolean,
  extendTop: number,
  joinY: number,
  yBottom: number,
  elbowR: number,
): string {
  const W = level * step;
  const xAt = (col: number) => col * step + step / 2;
  const endX = W - 1.5;
  const r = Math.min(elbowR, step / 2 - 0.5);
  const parts: string[] = [];

  for (let i = 0; i < level - 1; i++) {
    if (prefix[i]) {
      const x = xAt(i);
      parts.push(`M ${x} ${-extendTop} L ${x} ${yBottom}`);
    }
  }

  const xLast = xAt(level - 1);
  parts.push(`M ${xLast} ${-extendTop} L ${xLast} ${joinY - r}`);
  parts.push(`Q ${xLast} ${joinY} ${xLast + r} ${joinY}`);
  parts.push(`L ${endX} ${joinY}`);
  if (!isLast) {
    parts.push(`M ${xLast} ${joinY} L ${xLast} ${yBottom}`);
  }

  return parts.join(" ");
}

export function CommentThreadConnector({
  level,
  threadPrefix,
  isLastInThread,
  className,
}: CommentThreadConnectorProps) {
  if (level < 1) return null;

  const prefix = normalizePrefix(threadPrefix, level);
  const W = commentThreadGutterWidthPx(level);
  const yBottom = JOIN_Y + Y_BELOW;
  const vbH = EXTEND_TOP + yBottom;
  const d = buildTreePaths(
    level,
    COMMENT_THREAD_STEP_PX,
    prefix,
    isLastInThread,
    EXTEND_TOP,
    JOIN_Y,
    yBottom,
    ELBOW_R,
  );

  return (
    <div
      className={cn("pointer-events-none absolute top-0 overflow-visible", className)}
      style={{ left: -W, width: W }}
      aria-hidden
    >
      <svg
        width={W}
        height={vbH}
        viewBox={`0 ${-EXTEND_TOP} ${W} ${vbH}`}
        className="absolute left-0 top-0 block shrink-0 overflow-visible text-zinc-400/55 dark:text-zinc-500/65"
      >
        <path
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
