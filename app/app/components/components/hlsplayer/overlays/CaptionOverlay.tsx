import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { cn } from "~/lib/utils"
import {
  CAPTION_CONTROLS_FLOOR_PCT,
  CAPTION_DEFAULT_Y_PCT,
  useCaptionContext,
} from "../CaptionContext"
import type { CaptionFontSize, CaptionTextAlign } from "../CaptionContext"

interface CaptionOverlayProps {
  containerRef: React.RefObject<HTMLDivElement | null>
  controlsVisible: boolean
  compact?: boolean
}

const FONT_SCALE: Record<CaptionFontSize, number> = {
  sm: 0.7,
  md: 1,
  lg: 1.3,
  xl: 1.7,
}

function computeFontSizePx(width: number, height: number, sizePreference: CaptionFontSize): number {
  const baseline = Math.min(width * 0.045, height * 0.065)
  const clamped = Math.max(10, Math.min(baseline, 42))
  return clamped * FONT_SCALE[sizePreference]
}

const X_MIN = 5
const X_MAX = 95
const Y_MAX = 95
const AUTO_BOTTOM_ZONE_PCT = 25

const ALIGN_STYLE: Record<CaptionTextAlign, { left: string; transform: string }> = {
  left: { left: "4%", transform: "none" },
  center: { left: "50%", transform: "translateX(-50%)" },
  right: { left: "96%", transform: "translateX(-100%)" },
}

export default function CaptionOverlay({ containerRef, controlsVisible, compact }: CaptionOverlayProps) {
  const {
    currentCue,
    currentLanguage,
    position,
    setPosition,
    resetPosition,
    fontSize,
    textAlign,
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
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        setContainerSize((prev) =>
          prev.w === Math.round(width) && prev.h === Math.round(height)
            ? prev
            : { w: Math.round(width), h: Math.round(height) },
        )
      }
    })
    ro.observe(el)
    const rect = el.getBoundingClientRect()
    setContainerSize({ w: Math.round(rect.width), h: Math.round(rect.height) })
    return () => ro.disconnect()
  }, [containerRef])

  const dynamicFontSize = useMemo(() => {
    if (containerSize.w === 0 || containerSize.h === 0) return 16
    return computeFontSizePx(containerSize.w, containerSize.h, fontSize)
  }, [containerSize, fontSize])

  const renderedPosition = useMemo(() => {
    if (compact) {
      return { xPct: 50, yBottomPct: 8 }
    }
    const base = livePosition ?? position
    const floor = controlsVisible ? CAPTION_CONTROLS_FLOOR_PCT : 0
    let yBottom = base.yBottomPct
    if (!controlsVisible && yBottom <= AUTO_BOTTOM_ZONE_PCT) {
      yBottom = CAPTION_DEFAULT_Y_PCT
    }
    return {
      xPct: Math.min(X_MAX, Math.max(X_MIN, base.xPct)),
      yBottomPct: Math.min(Y_MAX, Math.max(floor, yBottom)),
    }
  }, [livePosition, position, controlsVisible, compact])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (compact) return
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
    [containerRef, position, compact],
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
  const alignStyle = compact ? ALIGN_STYLE.center : ALIGN_STYLE[textAlign]
  const useDragPosition = !compact && textAlign === "center"

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
        left: useDragPosition ? `${renderedPosition.xPct}%` : alignStyle.left,
        bottom: `${renderedPosition.yBottomPct}%`,
        transform: useDragPosition ? "translateX(-50%)" : alignStyle.transform,
        touchAction: "none",
        fontSize: `${dynamicFontSize}px`,
        lineHeight: 1.3,
        textAlign: compact ? "center" : textAlign,
        transition: dragging
          ? "none"
          : "bottom 200ms cubic-bezier(0.4, 0, 0.2, 1), font-size 150ms ease",
      }}
      className={cn(
        "absolute z-40 select-none px-3 py-1.5 rounded-md text-white max-w-[92%] pointer-events-auto",
        !compact && textAlign === "center" && "cursor-grab",
        dragging && "cursor-grabbing ring-2 ring-white/40",
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
