import { useEffect, useRef, useState } from "react"
import { Captions, CaptionsOff, Check, RotateCcw, Loader2 } from "lucide-react"
import { cn } from "~/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip"
import { useCaptionContext, type CaptionFontSize } from "../../CaptionContext"

const FONT_SIZE_OPTIONS: { value: CaptionFontSize; label: string }[] = [
  { value: "sm", label: "S" },
  { value: "md", label: "M" },
  { value: "lg", label: "L" },
  { value: "xl", label: "XL" },
]

export default function SubtitleButton({
  variant,
}: {
  variant?: "mobileOverlay" | "desktopPill"
}) {
  const {
    languages,
    currentLanguage,
    setCurrentLanguage,
    isLoading,
    fontSize,
    setFontSize,
    backgroundOpacity,
    setBackgroundOpacity,
    resetPosition,
  } = useCaptionContext()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    document.addEventListener("keydown", onEsc)
    return () => {
      document.removeEventListener("mousedown", onDocClick)
      document.removeEventListener("keydown", onEsc)
    }
  }, [open])

  if (languages.length === 0) return null

  const isActive = currentLanguage !== null

  const toggleSimple = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (languages.length === 1) {
      setCurrentLanguage(isActive ? null : languages[0].code)
      return
    }
    setOpen((prev) => !prev)
  }

  const labelText = isActive ? "Subtitles on" : "Subtitles off"

  const Icon = isActive ? Captions : CaptionsOff

  const triggerNode = (() => {
    if (variant === "mobileOverlay") {
      return (
        <button
          type="button"
          onClick={toggleSimple}
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/50 text-white shadow-sm backdrop-blur-sm active:scale-95 transition-transform",
            isActive && "text-primary",
          )}
          aria-label={labelText}
        >
          {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Icon className="w-5 h-5" />}
        </button>
      )
    }
    if (variant === "desktopPill") {
      return (
        <button
          type="button"
          onClick={toggleSimple}
          className={cn(
            "rounded-lg p-2 transition-colors hover:bg-white/10",
            isActive ? "text-primary" : "text-white",
          )}
          aria-label={labelText}
        >
          {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Icon className="w-5 h-5" />}
        </button>
      )
    }
    return (
      <button
        type="button"
        onClick={toggleSimple}
        className={cn(
          "rounded-md p-1.5 transition-colors hover:bg-white/10",
          isActive ? "text-primary" : "text-white",
        )}
        aria-label={labelText}
      >
        {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Icon className="w-5 h-5" />}
      </button>
    )
  })()

  const popover = open ? (
    <div
      onClick={(e) => e.stopPropagation()}
      className="absolute right-0 bottom-full mb-2 z-50 w-60 rounded-lg border border-white/15 bg-black/90 backdrop-blur-md text-white shadow-2xl text-sm overflow-hidden"
    >
      <div className="px-3 pt-2.5 pb-1 text-[10px] uppercase tracking-wider text-white/50 font-medium">
        Subtitles
      </div>
      <button
        type="button"
        onClick={() => {
          setCurrentLanguage(null)
          setOpen(false)
        }}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 hover:bg-white/10 transition-colors",
          !isActive && "text-primary",
        )}
      >
        <span>Off</span>
        {!isActive && <Check className="w-3.5 h-3.5" />}
      </button>
      {languages.map((lang) => {
        const selected = currentLanguage === lang.code
        return (
          <button
            key={lang.code}
            type="button"
            onClick={() => {
              setCurrentLanguage(lang.code)
              setOpen(false)
            }}
            className={cn(
              "w-full flex items-center justify-between px-3 py-2 hover:bg-white/10 transition-colors",
              selected && "text-primary",
            )}
          >
            <span className="truncate">{lang.label}</span>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] font-mono text-white/40">{lang.code}</span>
              {selected && <Check className="w-3.5 h-3.5" />}
            </div>
          </button>
        )
      })}

      <div className="my-1 border-t border-white/10" />

      <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-white/50 font-medium">
        Size
      </div>
      <div className="flex gap-1.5 px-3 pb-2">
        {FONT_SIZE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setFontSize(opt.value)}
            className={cn(
              "flex-1 h-7 rounded-md text-xs font-semibold border transition-colors",
              fontSize === opt.value
                ? "border-primary bg-primary/15 text-primary"
                : "border-white/20 hover:bg-white/10",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="px-3 pt-1 text-[10px] uppercase tracking-wider text-white/50 font-medium">
        Background
      </div>
      <div className="px-3 pb-2 pt-1">
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={backgroundOpacity}
          onChange={(e) => setBackgroundOpacity(Number(e.target.value))}
          className="w-full accent-primary"
          aria-label="Caption background opacity"
        />
        <div className="flex items-center justify-between text-[10px] text-white/50 mt-0.5 tabular-nums">
          <span>Transparent</span>
          <span>{Math.round(backgroundOpacity * 100)}%</span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          resetPosition()
          setOpen(false)
        }}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/70 hover:bg-white/10 hover:text-white border-t border-white/10 transition-colors"
      >
        <RotateCcw className="w-3 h-3" />
        Reset position
      </button>
    </div>
  ) : null

  return (
    <div ref={wrapRef} className="relative">
      <Tooltip delayDuration={350}>
        <TooltipTrigger asChild>{triggerNode}</TooltipTrigger>
        <TooltipContent side={variant === "mobileOverlay" ? "bottom" : "top"}>
          Subtitles (CC)
        </TooltipContent>
      </Tooltip>
      {popover}
    </div>
  )
}
