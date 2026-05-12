import { useCallback, useEffect, useRef, useState } from "react"
import { useMiniPlayerContext } from "~/lib/Context/MiniPlayerContext"
import { usePlayerContext, TILT_DRAG_SENSITIVITY, TILT_ZOOM_MIN, TILT_ZOOM_MAX } from "../PlayerContext"

const TAP_THRESHOLD_PX = 8
const PINCH_ZOOM_SENSITIVITY = 0.01
const WHEEL_ZOOM_SENSITIVITY = 0.002

export default function TiltOverlay() {
  const { miniPlayer } = useMiniPlayerContext()
  const { tiltMode, tiltRotation, tiltZoom, setTiltRotation, setTiltZoom, resetTiltRotation, togglePlay } =
    usePlayerContext()

  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startRotation: { x: number; y: number; z: number }
    moved: boolean
    shiftHeld: boolean
  } | null>(null)
  const [dragging, setDragging] = useState(false)

  const pinchRef = useRef<{
    active: boolean
    startDist: number
    startZoom: number
  } | null>(null)
  const touchesRef = useRef<Map<number, { x: number; y: number }>>(new Map())

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!tiltMode) return

      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (touchesRef.current.size === 2) {
        const pts = Array.from(touchesRef.current.values())
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
        pinchRef.current = { active: true, startDist: dist, startZoom: tiltZoom }
        dragRef.current = null
        setDragging(false)
        return
      }

      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startRotation: { x: tiltRotation.x, y: tiltRotation.y, z: tiltRotation.z },
        moved: false,
        shiftHeld: e.shiftKey,
      }
      setDragging(true)
    },
    [tiltMode, tiltRotation.x, tiltRotation.y, tiltRotation.z, tiltZoom],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (pinchRef.current?.active && touchesRef.current.size >= 2) {
        const pts = Array.from(touchesRef.current.values())
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
        const delta = dist - pinchRef.current.startDist
        const newZoom = pinchRef.current.startZoom + delta * PINCH_ZOOM_SENSITIVITY
        setTiltZoom(newZoom)
        return
      }

      const drag = dragRef.current
      if (!drag || drag.pointerId !== e.pointerId) return
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      const dist2 = dx * dx + dy * dy
      if (dist2 > TAP_THRESHOLD_PX * TAP_THRESHOLD_PX) drag.moved = true

      if (drag.shiftHeld || e.shiftKey) {
        const nextZ = drag.startRotation.z + dx * TILT_DRAG_SENSITIVITY * 0.5
        setTiltRotation({ x: tiltRotation.x, y: tiltRotation.y, z: nextZ })
      } else {
        const nextY = drag.startRotation.y + dx * TILT_DRAG_SENSITIVITY
        const nextX = drag.startRotation.x - dy * TILT_DRAG_SENSITIVITY
        setTiltRotation({ x: nextX, y: nextY, z: tiltRotation.z })
      }
    },
    [setTiltRotation, setTiltZoom, tiltRotation.x, tiltRotation.y, tiltRotation.z],
  )

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      touchesRef.current.delete(e.pointerId)

      if (pinchRef.current?.active) {
        if (touchesRef.current.size < 2) {
          pinchRef.current = null
        }
        return
      }

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
    if (!tiltMode) return
    const el = document.querySelector('.player_inner') as HTMLElement | null
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const delta = -e.deltaY * WHEEL_ZOOM_SENSITIVITY
      setTiltZoom(tiltZoom + delta)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [tiltMode, tiltZoom, setTiltZoom])

  useEffect(() => {
    if (!tiltMode) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        setTiltZoom(tiltZoom + 0.1)
      } else if (e.key === '-') {
        e.preventDefault()
        setTiltZoom(tiltZoom - 0.1)
      } else if (e.key === '0') {
        e.preventDefault()
        setTiltZoom(1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [tiltMode, tiltZoom, setTiltZoom])

  useEffect(() => {
    if (!dragging) return
    const onBlur = () => {
      dragRef.current = null
      setDragging(false)
      pinchRef.current = null
      touchesRef.current.clear()
    }
    window.addEventListener("blur", onBlur)
    return () => window.removeEventListener("blur", onBlur)
  }, [dragging])

  /** Mini player steals the `<video>`; skip orbit overlay so gestures don’t target empty chrome behind it. */
  if (!tiltMode || miniPlayer) return null

  return (
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
      aria-label="Drag to orbit, Shift+drag to skew, pinch or Ctrl+scroll to zoom"
    />
  )
}
