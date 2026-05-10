import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Upload, AlertCircle, CornerDownLeft } from "lucide-react"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import {
  MAX_CUE_TEXT_LENGTH,
  MAX_VTT_BYTES,
  cuesToSecondsMap,
  formatTimestamp,
  parseTimestamp,
  parseVTT,
  secondsMapToCues,
} from "~/lib/captions/vtt"
import type { CaptionCue } from "~/lib/captions/vtt"

const ROW_HEIGHT = 40
const OVERSCAN = 8
const MIN_DURATION_SECONDS = 1
const MAX_DURATION_SECONDS = 12 * 60 * 60

interface CaptionEditorProps {
  cues: CaptionCue[]
  duration: number
  onChange: (cues: CaptionCue[]) => void
  disabled?: boolean
}

export function CaptionEditor({ cues, duration, onChange, disabled }: CaptionEditorProps) {
  const totalSeconds = useMemo(() => {
    if (!Number.isFinite(duration) || duration <= 0) return MIN_DURATION_SECONDS
    return Math.min(MAX_DURATION_SECONDS, Math.max(MIN_DURATION_SECONDS, Math.floor(duration)))
  }, [duration])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<Map<number, HTMLTextAreaElement>>(new Map())

  const [secondsText, setSecondsText] = useState<Map<number, string>>(() =>
    cuesToSecondsMap(cues, totalSeconds),
  )
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(480)
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [isImporting, setIsImporting] = useState(false)
  const [pendingFocus, setPendingFocus] = useState<number | null>(null)
  const [jumpInput, setJumpInput] = useState("")
  const [jumpInvalid, setJumpInvalid] = useState(false)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setViewportHeight(el.clientHeight || 480)
    measure()
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(measure)
      ro.observe(el)
      return () => ro.disconnect()
    }
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [])

  const totalHeight = totalSeconds * ROW_HEIGHT
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const endIndex = Math.min(
    totalSeconds,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  )

  const visibleSeconds = useMemo(() => {
    const arr: number[] = []
    for (let s = startIndex; s < endIndex; s++) arr.push(s)
    return arr
  }, [startIndex, endIndex])

  const filledCount = secondsText.size

  const updateSecond = useCallback(
    (second: number, text: string) => {
      setSecondsText((prev) => {
        const next = new Map(prev)
        const trimmed = text.slice(0, MAX_CUE_TEXT_LENGTH)
        if (trimmed.trim().length === 0) next.delete(second)
        else next.set(second, trimmed)
        onChange(secondsMapToCues(next))
        return next
      })
    },
    [onChange],
  )

  const scrollToSecond = useCallback(
    (second: number, align: "top" | "center" = "center") => {
      const el = scrollRef.current
      if (!el) return
      const target =
        align === "center"
          ? second * ROW_HEIGHT - viewportHeight / 2 + ROW_HEIGHT / 2
          : second * ROW_HEIGHT
      el.scrollTop = Math.max(0, Math.min(totalHeight - viewportHeight, target))
    },
    [totalHeight, viewportHeight],
  )

  const focusSecond = useCallback(
    (second: number) => {
      if (second < 0 || second >= totalSeconds) return
      const el = rowRefs.current.get(second)
      if (el) {
        const rect = el.getBoundingClientRect()
        const containerRect = scrollRef.current?.getBoundingClientRect()
        if (containerRect && (rect.top < containerRect.top || rect.bottom > containerRect.bottom)) {
          scrollToSecond(second)
        }
        el.focus()
        try {
          el.setSelectionRange(el.value.length, el.value.length)
        } catch {}
        return
      }
      scrollToSecond(second)
      setPendingFocus(second)
    },
    [scrollToSecond, totalSeconds],
  )

  useEffect(() => {
    if (pendingFocus === null) return
    const el = rowRefs.current.get(pendingFocus)
    if (!el) return
    el.focus()
    try {
      el.setSelectionRange(el.value.length, el.value.length)
    } catch {}
    setPendingFocus(null)
  }, [pendingFocus, visibleSeconds])

  const registerRow = useCallback((second: number, el: HTMLTextAreaElement | null) => {
    if (el) rowRefs.current.set(second, el)
    else rowRefs.current.delete(second)
  }, [])

  const handleFile = async (file: File) => {
    setImportErrors([])
    if (file.size > MAX_VTT_BYTES) {
      setImportErrors([`File too large (max ${Math.round(MAX_VTT_BYTES / 1024)}KB)`])
      return
    }
    setIsImporting(true)
    try {
      const text = await file.text()
      const result = parseVTT(text)
      if (result.cues.length === 0) {
        setImportErrors(result.errors.length ? result.errors : ["No valid cues found"])
        return
      }
      const map = cuesToSecondsMap(result.cues, totalSeconds)
      setSecondsText(map)
      onChange(secondsMapToCues(map))
      if (result.errors.length) setImportErrors(result.errors)
    } catch {
      setImportErrors(["Could not read file"])
    } finally {
      setIsImporting(false)
    }
  }

  const handleJump = () => {
    const trimmed = jumpInput.trim()
    if (!trimmed) return
    const parsed = parseTimestamp(trimmed) ?? Number(trimmed)
    if (!Number.isFinite(parsed) || parsed < 0) {
      setJumpInvalid(true)
      return
    }
    const second = Math.min(totalSeconds - 1, Math.max(0, Math.floor(parsed)))
    setJumpInvalid(false)
    focusSecond(second)
  }

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept=".vtt,text/vtt,text/plain"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (fileInputRef.current) fileInputRef.current.value = ""
          if (file) void handleFile(file)
        }}
        className="hidden"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => !disabled && fileInputRef.current?.click()}
          disabled={disabled || isImporting}
          className="h-9"
        >
          <Upload className="w-3.5 h-3.5 mr-1.5" />
          {isImporting ? "Reading..." : "Import .vtt"}
        </Button>

        <div className="flex items-center gap-1.5">
          <Input
            value={jumpInput}
            onChange={(e) => {
              setJumpInput(e.target.value)
              setJumpInvalid(false)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                handleJump()
              }
            }}
            placeholder="Jump to 0:00"
            disabled={disabled}
            className={`h-9 w-32 font-mono text-xs ${jumpInvalid ? "border-destructive" : ""}`}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleJump}
            disabled={disabled || !jumpInput.trim()}
            className="h-9 w-9"
            aria-label="Jump"
          >
            <CornerDownLeft className="w-3.5 h-3.5" />
          </Button>
        </div>

        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
          {filledCount}/{totalSeconds} · {formatTimestamp(totalSeconds)}
        </span>
      </div>

      {importErrors.length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-[11px] text-destructive space-y-0.5">
          {importErrors.slice(0, 4).map((err, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>{err}</span>
            </div>
          ))}
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        className="relative rounded-lg border border-border/50 bg-background/40 overflow-y-auto"
        style={{ height: "55vh" }}
      >
        <div style={{ height: totalHeight, position: "relative" }}>
          {visibleSeconds.map((second) => (
            <div
              key={second}
              style={{
                position: "absolute",
                top: second * ROW_HEIGHT,
                left: 0,
                right: 0,
                height: ROW_HEIGHT,
              }}
            >
              <SecondRow
                second={second}
                value={secondsText.get(second) ?? ""}
                disabled={disabled}
                onChange={(text) => updateSecond(second, text)}
                onAdvance={(dir) => focusSecond(second + dir)}
                registerRef={registerRow}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

interface SecondRowProps {
  second: number
  value: string
  disabled?: boolean
  onChange: (value: string) => void
  onAdvance: (direction: 1 | -1) => void
  registerRef: (second: number, el: HTMLTextAreaElement | null) => void
}

function SecondRow({ second, value, disabled, onChange, onAdvance, registerRef }: SecondRowProps) {
  const [local, setLocal] = useState(value)
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    setLocal(value)
  }, [value])

  const commit = (next: string) => {
    if (next !== value) onChange(next)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = taRef.current
    if (!ta) return
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      commit(local)
      onAdvance(1)
      return
    }
    if (
      e.key === "ArrowDown" &&
      ta.selectionStart === ta.value.length &&
      ta.selectionEnd === ta.value.length
    ) {
      e.preventDefault()
      commit(local)
      onAdvance(1)
      return
    }
    if (e.key === "ArrowUp" && ta.selectionStart === 0 && ta.selectionEnd === 0) {
      e.preventDefault()
      commit(local)
      onAdvance(-1)
    }
  }

  return (
    <div className="flex items-center gap-3 h-full px-3 border-b border-border/30 hover:bg-muted/20 transition-colors focus-within:bg-muted/30">
      <span className="font-mono text-[11px] text-muted-foreground/80 tabular-nums shrink-0 w-[68px] select-none">
        {formatTimestamp(second)}
      </span>
      <textarea
        ref={(el) => {
          taRef.current = el
          registerRef(second, el)
        }}
        value={local}
        onChange={(e) => setLocal(e.target.value.slice(0, MAX_CUE_TEXT_LENGTH))}
        onBlur={() => commit(local)}
        onKeyDown={handleKeyDown}
        rows={1}
        placeholder="—"
        disabled={disabled}
        maxLength={MAX_CUE_TEXT_LENGTH}
        className="flex-1 h-full text-sm bg-transparent border-0 outline-none ring-0 focus:ring-0 focus:outline-none resize-none px-0 py-0 text-foreground placeholder:text-muted-foreground/40 leading-[40px]"
      />
    </div>
  )
}
