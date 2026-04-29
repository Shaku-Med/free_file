import { cn } from "~/lib/utils";

/** Stroke width — YouTube-like thin rails; still visible on OLED. */
const STROKE = 1.5;
/** Horizontal width of one thread column (indent per nesting level). */
export const COMMENT_THREAD_STEP_PX = 28;
/** @deprecated Use commentThreadGutterWidthPx(level) — kept for imports expecting a single step. */
export const COMMENT_THREAD_GUTTER_PX = COMMENT_THREAD_STEP_PX;
/** Matches `Avatar` in CommentItem (`h-9 w-9`) so the elbow meets the avatar center. */
export const COMMENT_AVATAR_SIZE_PX = 36;
const JOIN_Y = COMMENT_AVATAR_SIZE_PX / 2;
/** Rounded "└" elbow radius (YouTube-style bend toward the avatar). */
const ELBOW_R = 8;

const RAIL_CLASS = "absolute bg-zinc-400/55 dark:bg-zinc-500/65";

export function commentThreadGutterWidthPx(level: number): number {
  return Math.max(0, level) * COMMENT_THREAD_STEP_PX;
}

function normalizePrefix(threadPrefix: boolean[], level: number): boolean[] {
  const need = Math.max(0, level - 1);
  const out = threadPrefix.slice(0, need);
  while (out.length < need) out.push(false);
  return out;
}

function xAtCol(col: number): number {
  return col * COMMENT_THREAD_STEP_PX + COMMENT_THREAD_STEP_PX / 2;
}

type RailsProps = {
  level: number;
  /** Length must be `level - 1`: column `i` draws a full vertical rail if true (ancestor had a younger sibling). */
  threadPrefix: boolean[];
  /** When true, the rail at column `level-1` stops at the avatar (no rail below for next sibling). */
  isLastInThread: boolean;
  className?: string;
};

/**
 * Vertical thread rails — rendered at the comment's *outer* container level so they extend
 * the full height of the comment plus its reply subtree. This is what fixes the gap that
 * the previous fixed-height SVG had on tall comments. Each rail is one absolute span.
 */
export function CommentThreadRails({
  level,
  threadPrefix,
  isLastInThread,
  className,
}: RailsProps) {
  if (level < 1) return null;
  const prefix = normalizePrefix(threadPrefix, level);
  const ownX = xAtCol(level - 1);

  return (
    <div
      className={cn("pointer-events-none absolute inset-0 overflow-visible", className)}
      aria-hidden
    >
      {/* Ancestor rails — always full height of this subtree. */}
      {prefix.map((draw, i) =>
        draw ? (
          <span
            key={i}
            className={cn(RAIL_CLASS, "top-0 bottom-0")}
            style={{ left: xAtCol(i) - STROKE / 2, width: STROKE }}
          />
        ) : null,
      )}
      {/* Own column rail — full height when has next sibling, otherwise stops above the elbow. */}
      {isLastInThread ? (
        <span
          className={cn(RAIL_CLASS, "top-0")}
          style={{
            left: ownX - STROKE / 2,
            width: STROKE,
            height: JOIN_Y - ELBOW_R + STROKE / 2,
          }}
        />
      ) : (
        <span
          className={cn(RAIL_CLASS, "top-0 bottom-0")}
          style={{ left: ownX - STROKE / 2, width: STROKE }}
        />
      )}
    </div>
  );
}

type ElbowProps = {
  /** Used only as a guard — elbow geometry is identical at every level. */
  level: number;
  className?: string;
};

/**
 * The "└" curve from rail → avatar, sized just to the elbow. Lives inside the row wrapper
 * (negative `left` puts it back into the gutter the parent has padded for us), so it
 * stays vertically aligned with the avatar even if the row resizes.
 */
export function CommentThreadElbow({ level, className }: ElbowProps) {
  if (level < 1) return null;
  const w = COMMENT_THREAD_STEP_PX / 2 + STROKE;
  const h = ELBOW_R + STROKE;
  // The elbow rises from the rail (column center) and curves to meet the row's left edge.
  const startX = STROKE / 2;
  const d = `M ${startX} 0 Q ${startX} ${ELBOW_R} ${ELBOW_R + startX} ${ELBOW_R} L ${w - STROKE / 2} ${ELBOW_R}`;
  return (
    <svg
      className={cn(
        "pointer-events-none absolute text-zinc-400/55 dark:text-zinc-500/65",
        className,
      )}
      width={w}
      height={h}
      style={{
        left: -COMMENT_THREAD_STEP_PX / 2 - STROKE / 2,
        top: JOIN_Y - ELBOW_R,
      }}
      aria-hidden
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
  );
}

/**
 * @deprecated Kept as a thin wrapper for any external imports. Renders rails + elbow together,
 * but in the new layout you should call {@link CommentThreadRails} at the outer container
 * (so they span the full subtree height) and {@link CommentThreadElbow} inside the row.
 */
export function CommentThreadConnector(props: RailsProps) {
  return (
    <>
      <CommentThreadRails {...props} />
      <CommentThreadElbow level={props.level} />
    </>
  );
}
