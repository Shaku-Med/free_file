import { useCallback, useEffect, useRef, useState } from "react"
import { RotateCcw } from "lucide-react"
import { usePlayerContext, VR_DRAG_SENSITIVITY } from "../PlayerContext"

const TAP_THRESHOLD_PX = 8

/**
 * Captures pointer drags over the video to orbit the CSS-3D tilt. Mounted only
 * when `vrMode` is on so it never intercepts events otherwise. Short taps
 * (movement under {@link TAP_THRESHOLD_PX}) pass through to play/pause via the
 * player's existing `togglePlay`.
 */
export default function VRTiltOverlay() {
  const { vrMode, vrRotation, setVrRotation, resetVrRotation, togglePlay } =
    usePlayerContext()

  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startRotation: { x: number; y: number }
    moved: boolean
  } | null>(null)
  const [dragging, setDragging] = useState(false)

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!vrMode) return
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startRotation: { x: vrRotation.x, y: vrRotation.y },
        moved: false,
      }
      setDragging(true)
    },
    [vrMode, vrRotation.x, vrRotation.y],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== e.pointerId) return
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      const dist2 = dx * dx + dy * dy
      if (dist2 > TAP_THRESHOLD_PX * TAP_THRESHOLD_PX) drag.moved = true
      const nextY = drag.startRotation.y + dx * VR_DRAG_SENSITIVITY
      const nextX = drag.startRotation.x - dy * VR_DRAG_SENSITIVITY
      setVrRotation({ x: nextX, y: nextY })
    },
    [setVrRotation],
  )

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== e.pointerId) return
      try {
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {}
      const wasTap = !drag.moved
      dragRef.current = null
      setDragging(false)
      if (wasTap) togglePlay()
    },
    [togglePlay],
  )

  useEffect(() => {
    if (!dragging) return
    const onBlur = () => {
      dragRef.current = null
      setDragging(false)
    }
    window.addEventListener("blur", onBlur)
    return () => window.removeEventListener("blur", onBlur)
  }, [dragging])

  if (!vrMode) return null

  return (
    <>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(e) => e.stopPropagation()}
        className="absolute inset-0 z-30 pointer-events-auto"
        style={{
          cursor: dragging ? "grabbing" : "grab",
          touchAction: "none",
        }}
        aria-label="Drag to orbit"
      />
      {(vrRotation.x !== 0 || vrRotation.y !== 0) && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            resetVrRotation()
          }}
          className="absolute top-3 right-3 z-40 flex h-8 items-center gap-1.5 rounded-full bg-black/55 px-2.5 text-[11px] font-medium text-white backdrop-blur-sm hover:bg-black/70 transition-colors"
          aria-label="Reset tilt"
        >
          <RotateCcw className="w-3 h-3" />
          Reset
        </button>
      )}
    </>
  )
}
