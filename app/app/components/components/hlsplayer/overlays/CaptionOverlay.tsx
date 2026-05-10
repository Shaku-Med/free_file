import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { cn } from "~/lib/utils"
import {
  CAPTION_CONTROLS_FLOOR_PCT,
  CAPTION_DEFAULT_Y_PCT,
  useCaptionContext,
} from "../CaptionContext"
import type { CaptionFontSize } from "../CaptionContext"

interface CaptionOverlayProps {
  containerRef: React.RefObject<HTMLDivElement | null>
  controlsVisible: boolean
}

const FONT_SIZE_CLASS: Record<CaptionFontSize, string> = {
  sm: "text-sm md:text-base leading-snug",
  md: "text-base md:text-lg leading-snug",
  lg: "text-lg md:text-2xl leading-tight",
  xl: "text-2xl md:text-4xl leading-tight",
}

const X_MIN = 5
const X_MAX = 95
const Y_MAX = 95

export default function CaptionOverlay({ containerRef, controlsVisible }: CaptionOverlayProps) {
  const {
    currentCue,
    currentLanguage,
    position,
    setPosition,
    resetPosition,
    fontSize,
    backgroundOpacity,
  } = useCaptionContext()

  const captionRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startPos: { xPct: number; yBottomPct: number }
    rect: DOMRect
    movedBelowFloor: boolean
  } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [livePosition, setLivePosition] = useState<{ xPct: number; yBottomPct: number } | null>(null)

  const renderedPosition = useMemo(() => {
    const base = livePosition ?? position
    const floor = controlsVisible ? CAPTION_CONTROLS_FLOOR_PCT : 0
    return {
      xPct: Math.min(X_MAX, Math.max(X_MIN, base.xPct)),
      yBottomPct: Math.min(Y_MAX, Math.max(floor, base.yBottomPct)),
    }
  }, [livePosition, position, controlsVisible])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startPos: position,
        rect,
        movedBelowFloor: false,
      }
      setDragging(true)
      setLivePosition(position)
      e.preventDefault()
      e.stopPropagation()
    },
    [containerRef, position],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== e.pointerId) return
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      const xPct = drag.startPos.xPct + (dx / drag.rect.width) * 100
      const yBottomPct = drag.startPos.yBottomPct - (dy / drag.rect.height) * 100
      const clampedX = Math.min(X_MAX, Math.max(X_MIN, xPct))
      const clampedY = Math.min(Y_MAX, Math.max(2, yBottomPct))
      if (clampedY < CAPTION_CONTROLS_FLOOR_PCT) drag.movedBelowFloor = true
      setLivePosition({ xPct: clampedX, yBottomPct: clampedY })
    },
    [],
  )

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== e.pointerId) return
      try {
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {}
      const live = livePosition
      const movedBelowFloor = drag.movedBelowFloor
      dragRef.current = null
      setDragging(false)
      setLivePosition(null)
      if (!live) return
      if (movedBelowFloor && live.yBottomPct < CAPTION_CONTROLS_FLOOR_PCT) {
        resetPosition()
      } else {
        setPosition(live)
      }
    },
    [livePosition, resetPosition, setPosition],
  )

  useEffect(() => {
    if (!dragging) return
    const onWindowBlur = () => {
      dragRef.current = null
      setDragging(false)
      setLivePosition(null)
    }
    window.addEventListener("blur", onWindowBlur)
    return () => window.removeEventListener("blur", onWindowBlur)
  }, [dragging])

  if (!currentLanguage || !currentCue) return null

  const lines = currentCue.split("\n")

  return (
    <div
      ref={captionRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        left: `${renderedPosition.xPct}%`,
        bottom: `${renderedPosition.yBottomPct}%`,
        transform: "translateX(-50%)",
        touchAction: "none",
        transition: dragging
          ? "none"
          : "bottom 200ms cubic-bezier(0.4, 0, 0.2, 1)",
      }}
      className={cn(
        "absolute z-40 select-none px-3 py-1.5 rounded-md text-center text-white max-w-[92%] pointer-events-auto cursor-grab",
        dragging && "cursor-grabbing ring-2 ring-white/40",
        FONT_SIZE_CLASS[fontSize],
      )}
    >
      <div
        aria-hidden
        className="absolute inset-0 -z-10 rounded-md"
        style={{ backgroundColor: `rgba(0, 0, 0, ${backgroundOpacity})` }}
      />
      {lines.map((line, i) => (
        <div
          key={i}
          className="font-medium drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]"
        >
          {line}
        </div>
      ))}
    </div>
  )
}

export { CAPTION_DEFAULT_Y_PCT }
