import { cn } from "~/lib/utils";

/** Stroke width  YouTube-like thin rails; still visible on OLED. */
const STROKE = 1.5;
/** Horizontal width of one thread column (indent per nesting level). */
export const COMMENT_THREAD_STEP_PX = 28;
/** @deprecated Use commentThreadGutterWidthPx(level)  kept for imports expecting a single step. */
export const COMMENT_THREAD_GUTTER_PX = COMMENT_THREAD_STEP_PX;
/** Matches `Avatar` in CommentItem (`h-9 w-9`) so the elbow meets the avatar center. */
export const COMMENT_AVATAR_SIZE_PX = 36;
const JOIN_Y = COMMENT_AVATAR_SIZE_PX / 2;
/** Rounded "└" elbow radius (YouTube-style bend toward the avatar). */
const ELBOW_R = 8;
/** Horizontal reach of the elbow: from the rail center to the avatar's left edge. */
const ELBOW_REACH = COMMENT_THREAD_STEP_PX - COMMENT_AVATAR_SIZE_PX / 2;

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

/** Rail x position aligned with the parent avatar's horizontal center. */
function xAtCol(col: number): number {
  return col * COMMENT_THREAD_STEP_PX + COMMENT_AVATAR_SIZE_PX / 2;
}

type RailsProps = {
  level: number;
  /** Length must be `level - 1`: column `i` draws a full vertical rail if true (ancestor had a younger sibling). */
  threadPrefix: boolean[];
  /** When true, the rail at column `level-1` stops at the avatar (no rail below for next sibling). */
  isLastInThread: boolean;
  /** Called when the user clicks the own-column rail to fold/unfold. */
  onToggleFold?: () => void;
  className?: string;
};

const RAIL_HIT_W = 16;

/**
 * Vertical thread rails  rendered at the comment's *outer* container level so they extend
 * the full height of the comment plus its reply subtree. Each rail is one absolute span.
 * The own-column rail is clickable when `onToggleFold` is provided.
 */
export function CommentThreadRails({
  level,
  threadPrefix,
  isLastInThread,
  onToggleFold,
  className,
}: RailsProps) {
  if (level < 1) return null;
  const prefix = normalizePrefix(threadPrefix, level);
  const ownX = xAtCol(level - 1);

  return (
    <div
      className={cn("absolute inset-0 overflow-visible", onToggleFold ? "" : "pointer-events-none", className)}
      aria-hidden
    >
      {/* Ancestor rails  always full height of this subtree. */}
      {prefix.map((draw, i) =>
        draw ? (
          <span
            key={i}
            className={cn(RAIL_CLASS, "pointer-events-none top-0 bottom-0")}
            style={{ left: xAtCol(i) - STROKE / 2, width: STROKE }}
          />
        ) : null,
      )}
      {/* Own column rail  clickable hit area wrapping the thin visual line. */}
      {isLastInThread ? (
        onToggleFold ? (
          <button
            type="button"
            onClick={onToggleFold}
            className="absolute top-0 group/rail cursor-pointer"
            style={{ left: ownX - RAIL_HIT_W / 2, width: RAIL_HIT_W, height: JOIN_Y - ELBOW_R + STROKE / 2, background: "none", border: "none", padding: 0 }}
            aria-label="Toggle thread"
          >
            <span
              className={cn(RAIL_CLASS, "absolute left-1/2 -translate-x-1/2 top-0 bottom-0 transition-colors duration-150 group-hover/rail:bg-zinc-400 dark:group-hover/rail:bg-zinc-400")}
              style={{ width: STROKE }}
            />
          </button>
        ) : (
          <span
            className={cn(RAIL_CLASS, "pointer-events-none top-0")}
            style={{ left: ownX - STROKE / 2, width: STROKE, height: JOIN_Y - ELBOW_R + STROKE / 2 }}
          />
        )
      ) : onToggleFold ? (
        <button
          type="button"
          onClick={onToggleFold}
          className="absolute top-0 bottom-0 group/rail cursor-pointer"
          style={{ left: ownX - RAIL_HIT_W / 2, width: RAIL_HIT_W, background: "none", border: "none", padding: 0 }}
          aria-label="Toggle thread"
        >
          <span
            className={cn(RAIL_CLASS, "absolute left-1/2 -translate-x-1/2 top-0 bottom-0 transition-colors duration-150 group-hover/rail:bg-zinc-400 dark:group-hover/rail:bg-zinc-400")}
            style={{ width: STROKE }}
          />
        </button>
      ) : (
        <span
          className={cn(RAIL_CLASS, "pointer-events-none top-0 bottom-0")}
          style={{ left: ownX - STROKE / 2, width: STROKE }}
        />
      )}
    </div>
  );
}

type ElbowProps = {
  /** Used only as a guard  elbow geometry is identical at every level. */
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
  const w = ELBOW_REACH + STROKE;
  const h = ELBOW_R + STROKE;
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
        left: -ELBOW_REACH - STROKE / 2,
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
