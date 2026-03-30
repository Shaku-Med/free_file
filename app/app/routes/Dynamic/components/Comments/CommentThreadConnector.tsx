import { cn } from "~/lib/utils";

const STROKE = 1.75;
/** Horizontal width of one thread column (nested “folder” rail). */
export const COMMENT_THREAD_STEP_PX = 20;
/** @deprecated Use commentThreadGutterWidthPx(level) — kept for imports expecting a single step. */
export const COMMENT_THREAD_GUTTER_PX = COMMENT_THREAD_STEP_PX;

export function commentThreadGutterWidthPx(level: number): number {
  return Math.max(0, level) * COMMENT_THREAD_STEP_PX;
}

const EXTEND_TOP = 56;
/** Branch Y: vertical center of h-8 avatar row */
const JOIN_Y = 16;
/** Spine continues below row into gap before next sibling */
const Y_BELOW = 22;

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

/** Sharp file-tree paths: prefix rails + last-column └ or ├ + horizontal to avatar. */
function buildTreePaths(
  level: number,
  step: number,
  prefix: boolean[],
  isLast: boolean,
  extendTop: number,
  joinY: number,
  yBottom: number
): string {
  const W = level * step;
  const xAt = (col: number) => col * step + step / 2;
  const endX = W - 1.5;
  const parts: string[] = [];

  for (let i = 0; i < level - 1; i++) {
    if (prefix[i]) {
      const x = xAt(i);
      parts.push(`M ${x} ${-extendTop} L ${x} ${yBottom}`);
    }
  }

  const xLast = xAt(level - 1);
  parts.push(`M ${xLast} ${-extendTop} L ${xLast} ${joinY}`);
  parts.push(`M ${xLast} ${joinY} L ${endX} ${joinY}`);
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
  const d = buildTreePaths(level, COMMENT_THREAD_STEP_PX, prefix, isLastInThread, EXTEND_TOP, JOIN_Y, yBottom);

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
        className="absolute left-0 top-0 block shrink-0 overflow-visible text-muted-foreground/50 dark:text-muted-foreground/55"
      >
        <path
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
      </svg>
    </div>
  );
}
