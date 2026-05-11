import { Captions, CaptionsOff, Check, RotateCcw, Loader2, AlignLeft, AlignCenter, AlignRight } from "lucide-react"
import { cn } from "~/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu"
import { useCaptionContext, type CaptionFontSize, type CaptionTextAlign } from "../../CaptionContext"

const FONT_SIZE_OPTIONS: { value: CaptionFontSize; label: string }[] = [
  { value: "sm", label: "S" },
  { value: "md", label: "M" },
  { value: "lg", label: "L" },
  { value: "xl", label: "XL" },
]

const TEXT_ALIGN_OPTIONS: { value: CaptionTextAlign; label: string; Icon: typeof AlignLeft }[] = [
  { value: "left", label: "Left", Icon: AlignLeft },
  { value: "center", label: "Center", Icon: AlignCenter },
  { value: "right", label: "Right", Icon: AlignRight },
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
    prefetchLanguage,
    isLoading,
    fontSize,
    setFontSize,
    textAlign,
    setTextAlign,
    backgroundOpacity,
    setBackgroundOpacity,
    resetPosition,
  } = useCaptionContext()

  /**
   * As soon as the user opens the menu, warm the cache for every available track
   * (and the saved preferred one first). VTT files are tiny — by the time they
   * decide which language to click, the response is already in cuesByLang, so
   * flipping it on feels instant instead of the prior 2-roundtrip stall.
   */
  const handleOpenChange = (open: boolean) => {
    if (!open) return
    if (currentLanguage) prefetchLanguage(currentLanguage)
    languages.forEach((l) => prefetchLanguage(l.code))
  }

  if (languages.length === 0) return null

  const isActive = currentLanguage !== null
  const labelText = isActive ? "Subtitles on" : "Subtitles off"
  const Icon = isActive ? Captions : CaptionsOff

  const triggerNode = (() => {
    if (variant === "mobileOverlay") {
      return (
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
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
          onClick={(e) => e.stopPropagation()}
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
        onClick={(e) => e.stopPropagation()}
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

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <Tooltip delayDuration={350}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>{triggerNode}</DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side={variant === "mobileOverlay" ? "bottom" : "top"}>
          Subtitles (CC)
        </TooltipContent>
      </Tooltip>

      <DropdownMenuContent
        align="end"
        side="top"
        sideOffset={8}
        className="w-60 z-[2147483647]"
      >
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Subtitles
        </DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={() => setCurrentLanguage(null)}
          className={cn(
            "flex items-center justify-between",
            !isActive && "text-primary focus:text-primary",
          )}
        >
          <span>Off</span>
          {!isActive && <Check className="w-3.5 h-3.5" />}
        </DropdownMenuItem>
        {languages.map((lang) => {
          const selected = currentLanguage === lang.code
          return (
            <DropdownMenuItem
              key={lang.code}
              onSelect={() => setCurrentLanguage(lang.code)}
              className={cn(
                "flex items-center justify-between gap-2",
                selected && "text-primary focus:text-primary",
              )}
            >
              <span className="truncate">{lang.label}</span>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] font-mono text-muted-foreground">{lang.code}</span>
                {selected && <Check className="w-3.5 h-3.5" />}
              </div>
            </DropdownMenuItem>
          )
        })}

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Size
        </DropdownMenuLabel>
        <div
          className="flex gap-1.5 px-2 pb-1.5"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {FONT_SIZE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setFontSize(opt.value)}
              className={cn(
                "flex-1 h-7 rounded-md text-xs font-semibold border transition-colors",
                fontSize === opt.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Alignment
        </DropdownMenuLabel>
        <div
          className="flex gap-1.5 px-2 pb-1.5"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {TEXT_ALIGN_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTextAlign(opt.value)}
              className={cn(
                "flex-1 h-7 rounded-md text-xs font-semibold border transition-colors flex items-center justify-center gap-1",
                textAlign === opt.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:bg-accent hover:text-accent-foreground",
              )}
              aria-label={opt.label}
            >
              <opt.Icon className="w-3.5 h-3.5" />
            </button>
          ))}
        </div>

        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Background
        </DropdownMenuLabel>
        <div
          className="px-2 pb-2"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
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
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-0.5 tabular-nums">
            <span>Transparent</span>
            <span>{Math.round(backgroundOpacity * 100)}%</span>
          </div>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onSelect={() => resetPosition()}
          className="text-xs text-muted-foreground focus:text-foreground"
        >
          <RotateCcw className="w-3 h-3 mr-2" />
          Reset position
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
