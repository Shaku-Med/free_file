import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { joinLines, layoutRoll, type RollCue, type RollFillet, type RollLine } from "~/lib/captions/rollup"
import type { CaptionTextAlign } from "../CaptionContext"

/** Line box height, side padding and corner radius, in em of the caption font. */
export const ROLL_LINE_EM = 1.45
export const ROLL_PAD_EM = 0.35
const ROLL_RADIUS_EM = 0.3
const VISIBLE_LINES = 2
const ROLL_MS = 260
const GROW_MS = 180
/** Canvas and DOM text widths can differ by a pixel or so; never clip a letter. */
const WIDTH_SLACK = 2

const ALIGN_ITEMS: Record<CaptionTextAlign, string> = {
  left: "flex-start",
  center: "center",
  right: "flex-end",
}

let measureCtx: CanvasRenderingContext2D | null = null

function useTextMeasure(fontPx: number) {
  return useMemo(() => {
    const cache = new Map<string, number>()
    const family = typeof document !== "undefined" ? getComputedStyle(document.body).fontFamily : "sans-serif"
    const font = `500 ${fontPx}px ${family}`
    return (text: string) => {
      const hit = cache.get(text)
      if (hit !== undefined) return hit
      if (!measureCtx && typeof document !== "undefined") {
        measureCtx = document.createElement("canvas").getContext("2d")
      }
      if (!measureCtx) return text.length * fontPx * 0.5
      measureCtx.font = font
      const width = measureCtx.measureText(text).width
      cache.set(text, width)
      return width
    }
  }, [fontPx])
}

/** The inverted corner: a square beside the line, filled except for a quarter circle. */
function filletStyle({ corner, r }: RollFillet, color: string): React.CSSProperties {
  const top = corner[0] === "t"
  const left = corner[1] === "l"
  // The hollow is centred on the square's corner furthest from both boxes.
  const at = `${left ? "0%" : "100%"} ${top ? "100%" : "0%"}`
  return {
    position: "absolute",
    width: `${r}px`,
    height: `${r}px`,
    [top ? "top" : "bottom"]: 0,
    [left ? "left" : "right"]: `${-r}px`,
    background: `radial-gradient(circle ${r}px at ${at}, transparent ${Math.max(0, r - 0.75)}px, ${color} ${r}px)`,
    pointerEvents: "none",
  }
}

interface RollupCaptionProps {
  roll: RollCue[]
  fontPx: number
  maxWidth: number
  align: CaptionTextAlign
  backgroundOpacity: number
}

/**
 * YouTube style roll-up: a line's box grows as each word arrives, easing the
 * words already there aside, and a new line slides the ones above it up while
 * the oldest fades out. The visible lines join into one shape that shares a
 * single corner radius.
 */
export default function RollupCaption({ roll, fontPx, maxWidth, align, backgroundOpacity }: RollupCaptionProps) {
  const measure = useTextMeasure(fontPx)
  const lines = useMemo(
    () => layoutRoll(roll, maxWidth, measure).slice(-(VISIBLE_LINES + 1)),
    [roll, maxWidth, measure],
  )

  // When the talking stops, the last lines fade out instead of vanishing.
  const [held, setHeld] = useState<RollLine[]>([])
  useEffect(() => {
    if (lines.length > 0) {
      setHeld(lines)
      return
    }
    const timer = setTimeout(() => setHeld([]), ROLL_MS)
    return () => clearTimeout(timer)
  }, [lines])
  const clearing = lines.length === 0
  const display = clearing ? held : lines

  // Whole pixels, and even widths so centred edges land on whole pixels too:
  // touching boxes then meet without a hairline seam.
  const lineHeight = Math.round(fontPx * ROLL_LINE_EM)
  const padX = fontPx * ROLL_PAD_EM
  const radius = Math.round(fontPx * ROLL_RADIUS_EM)
  const color = `rgba(0, 0, 0, ${backgroundOpacity})`
  const widths = display.map((line) => 2 * Math.ceil((line.width + padX * 2 + WIDTH_SLACK) / 2))
  const firstVisible = Math.max(0, display.length - VISIBLE_LINES)
  const shapes = joinLines(widths.slice(firstVisible), align, radius)

  const stackRef = useRef<HTMLDivElement>(null)
  const prevLastRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    const stack = stackRef.current
    const last = display.length > 0 ? display[display.length - 1].id : null
    const prev = prevLastRef.current
    prevLastRef.current = last
    if (!stack || !last || !prev || last === prev) return
    const prevIndex = display.findIndex((l) => l.id === prev)
    // A seek or a fresh start: nothing to slide from.
    if (prevIndex < 0) return
    const added = display.length - 1 - prevIndex
    stack.style.transition = "none"
    stack.style.transform = `translateY(${added * lineHeight}px)`
    void stack.getBoundingClientRect()
    stack.style.transition = `transform ${ROLL_MS}ms cubic-bezier(0.2, 0, 0, 1)`
    stack.style.transform = "translateY(0)"
  }, [display, lineHeight])

  return (
    <div
      ref={stackRef}
      className="caption-roll flex flex-col"
      style={{
        alignItems: ALIGN_ITEMS[align],
        opacity: clearing ? 0 : 1,
        transition: `opacity ${ROLL_MS}ms ease`,
      }}
    >
      {display.map((line, index) => {
        const outgoing = index < firstVisible
        // A line on its way out stands alone: its neighbour no longer joins it.
        const shape = outgoing ? null : shapes[index - firstVisible]
        const [tl, tr, br, bl] = shape ? shape.radii : [radius, radius, radius, radius]
        return (
          <div
            key={line.id}
            className="caption-fade-in relative font-medium text-white"
            style={{
              width: `${widths[index]}px`,
              height: `${lineHeight}px`,
              lineHeight: `${lineHeight}px`,
              borderRadius: `${tl}px ${tr}px ${br}px ${bl}px`,
              backgroundColor: color,
              opacity: outgoing ? 0 : 1,
              pointerEvents: outgoing || clearing ? "none" : "auto",
              transition: `width ${GROW_MS}ms cubic-bezier(0.2, 0, 0, 1), border-radius ${GROW_MS}ms ease, opacity ${ROLL_MS}ms ease`,
            }}
          >
            {shape?.fillets.map((fillet) => (
              <span key={fillet.corner} aria-hidden style={filletStyle(fillet, color)} />
            ))}
            <div
              className="h-full overflow-hidden whitespace-nowrap"
              style={{ paddingInline: `${padX}px`, textShadow: "0 1px 2px rgba(0, 0, 0, 0.85)" }}
            >
              {line.words.slice(0, line.shown).map((word, i) => (
                <Fragment key={i}>
                  {i > 0 && !word.glued ? " " : null}
                  <span className="caption-word-in">{word.text}</span>
                </Fragment>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
