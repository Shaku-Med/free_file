import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { createPortal } from "react-dom"
import { CloudUpload } from "lucide-react"
import { cn } from "~/lib/utils"
import { useSnapFloatsToCorners } from "~/lib/uiFloatPrefs"

type UploadProgressFloatProps = {
  progress: number
  failCount: number
  onOpen: () => void
}

/** Space taken by mobile tab bar + music mini bar (when published). */
function bottomReservePx(): number {
  if (typeof window === "undefined") return 0
  const root = document.documentElement
  const nav = parseFloat(
    root.style.getPropertyValue("--app-bottom-nav-h") ||
      getComputedStyle(root).getPropertyValue("--app-bottom-nav-h"),
  )
  const mini = parseFloat(
    root.style.getPropertyValue("--app-mini-player-h") ||
      getComputedStyle(root).getPropertyValue("--app-mini-player-h"),
  )
  return (Number.isFinite(nav) ? nav : 0) + (Number.isFinite(mini) ? mini : 0)
}

const SIZE = 56
const STROKE = 3.5
const R = (SIZE - STROKE) / 2
const CIRC = 2 * Math.PI * R
const PAD = 16

function poseBounds() {
  const w = window.innerWidth
  const h = window.innerHeight
  const bottom = bottomReservePx() + PAD
  const maxX = Math.max(PAD, w - SIZE - PAD)
  const maxY = Math.max(PAD, h - SIZE - bottom)
  return { minX: PAD, minY: PAD, maxX, maxY }
}

function clampPos(x: number, y: number) {
  const { minX, minY, maxX, maxY } = poseBounds()
  return {
    x: Math.min(maxX, Math.max(minX, x)),
    y: Math.min(maxY, Math.max(minY, y)),
  }
}

function nearestCorner(x: number, y: number): { x: number; y: number } {
  const { minX, minY, maxX, maxY } = poseBounds()
  const corners = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: minX, y: maxY },
    { x: maxX, y: maxY },
  ]
  const cx = x + SIZE / 2
  const cy = y + SIZE / 2
  let best = corners[3]!
  let bestD = Infinity
  for (const c of corners) {
    const d = Math.hypot(cx - (c.x + SIZE / 2), cy - (c.y + SIZE / 2))
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}

function placeDefault() {
  const { maxX, maxY } = poseBounds()
  return { x: maxX, y: maxY }
}

export function UploadProgressFloat({ progress, failCount, onOpen }: UploadProgressFloatProps) {
  const snapFloatsToCorners = useSnapFloatsToCorners()
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [snapping, setSnapping] = useState(false)
  const [dragging, setDragging] = useState(false)
  const userMovedRef = useRef(false)
  const draggingRef = useRef(false)
  const snapTimerRef = useRef<number | null>(null)
  const vpRef = useRef({
    w: typeof window !== "undefined" ? window.innerWidth : 400,
    h: typeof window !== "undefined" ? window.innerHeight : 800,
  })
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    origX: number
    origY: number
    moved: boolean
  } | null>(null)
  const prevSnapRef = useRef(snapFloatsToCorners)

  const clamp = useCallback((x: number, y: number) => clampPos(x, y), [])

  useEffect(() => {
    const syncViewport = () => {
      if (draggingRef.current) return
      const nw = window.innerWidth
      const nh = window.innerHeight
      const old = vpRef.current
      const sizeChanged = nw !== old.w || nh !== old.h
      vpRef.current = { w: nw, h: nh }

      setPos((prev) => {
        if (!userMovedRef.current || !prev) {
          const def = placeDefault()
          return snapFloatsToCorners ? nearestCorner(def.x, def.y) : def
        }
        if (!sizeChanged) {
          return clamp(prev.x, prev.y)
        }

        const travelOldX = Math.max(1, old.w - SIZE - PAD * 2)
        const travelOldY = Math.max(1, old.h - SIZE - PAD * 2)
        const rx = (prev.x - PAD) / travelOldX
        const ry = (prev.y - PAD) / travelOldY
        const { maxX, maxY } = poseBounds()
        const mapped = clamp(
          PAD + Math.min(1, Math.max(0, rx)) * (maxX - PAD),
          PAD + Math.min(1, Math.max(0, ry)) * (maxY - PAD),
        )
        return snapFloatsToCorners ? nearestCorner(mapped.x, mapped.y) : mapped
      })
    }

    syncViewport()
    window.addEventListener("resize", syncViewport)
    return () => window.removeEventListener("resize", syncViewport)
  }, [clamp, snapFloatsToCorners])

  useEffect(() => {
    const reclamp = () => {
      if (draggingRef.current) return
      setPos((prev) => {
        if (!prev) return prev
        const kept = clamp(prev.x, prev.y)
        return kept.x === prev.x && kept.y === prev.y ? prev : kept
      })
    }
    const mo = new MutationObserver(reclamp)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] })
    return () => mo.disconnect()
  }, [clamp])

  useEffect(() => {
    const wasOn = prevSnapRef.current
    prevSnapRef.current = snapFloatsToCorners
    if (!snapFloatsToCorners || wasOn) return
    setSnapping(true)
    setPos((prev) => (prev ? nearestCorner(prev.x, prev.y) : placeDefault()))
    const t = window.setTimeout(() => setSnapping(false), 420)
    return () => window.clearTimeout(t)
  }, [snapFloatsToCorners])

  useEffect(() => {
    return () => {
      if (snapTimerRef.current != null) window.clearTimeout(snapTimerRef.current)
    }
  }, [])

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || !pos) return
    if (snapTimerRef.current != null) {
      window.clearTimeout(snapTimerRef.current)
      snapTimerRef.current = null
    }
    setSnapping(false)
    draggingRef.current = true
    setDragging(true)
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
      moved: false,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved && dx * dx + dy * dy < 16) return
    d.moved = true
    userMovedRef.current = true
    setPos(clamp(d.origX + dx, d.origY + dy))
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    dragRef.current = null
    draggingRef.current = false
    setDragging(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    if (!d.moved) {
      onOpen()
      return
    }
    if (snapFloatsToCorners) {
      setSnapping(true)
      setPos((prev) => (prev ? nearestCorner(prev.x, prev.y) : prev))
      snapTimerRef.current = window.setTimeout(() => {
        setSnapping(false)
        snapTimerRef.current = null
      }, 420)
    } else {
      setPos((prev) => (prev ? clamp(prev.x, prev.y) : prev))
    }
  }

  const pct = Math.max(0, Math.min(100, Math.round(progress)))
  const dashOffset = CIRC - (pct / 100) * CIRC
  const showBadge = failCount > 0

  if (!pos) return null

  return createPortal(
    <button
      type="button"
      aria-label={
        showBadge
          ? `Upload progress ${pct} percent, ${failCount} failed. Tap to open.`
          : `Upload progress ${pct} percent. Tap to open.`
      }
      className={cn(
        "fixed touch-none select-none rounded-full border border-border/60 bg-card text-card-foreground shadow-lg",
        "cursor-grab active:cursor-grabbing",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      style={{
        left: pos.x,
        top: pos.y,
        width: SIZE,
        height: SIZE,
        zIndex: 2147483647,
        transition: dragging
          ? "none"
          : snapping
            ? "left 420ms cubic-bezier(0.22, 1, 0.36, 1), top 420ms cubic-bezier(0.22, 1, 0.36, 1), transform 420ms cubic-bezier(0.22, 1, 0.36, 1)"
            : // transform must stay covered at rest: the snap pulse (scale 1.06)
              // relaxes AFTER `snapping` flips off, and without this it pops.
              "left 220ms cubic-bezier(0.22, 1, 0.36, 1), top 220ms cubic-bezier(0.22, 1, 0.36, 1), transform 220ms cubic-bezier(0.22, 1, 0.36, 1)",
        transform: snapping ? "scale(1.06)" : "scale(1)",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <svg
        className="pointer-events-none absolute inset-0 -rotate-90"
        width={SIZE}
        height={SIZE}
        aria-hidden
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          className="text-muted/40"
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={dashOffset}
          className={cn(
            "transition-[stroke-dashoffset] duration-300",
            showBadge ? "text-destructive" : "text-primary",
          )}
        />
      </svg>
      <span className="relative flex h-full w-full items-center justify-center">
        <CloudUpload className="h-5 w-5 text-foreground" />
      </span>
      {showBadge ? (
        <span className="absolute -right-1 -top-1 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground shadow-md ring-2 ring-card">
          {failCount > 9 ? "9+" : failCount}
        </span>
      ) : null}
    </button>,
    document.body,
  )
}
