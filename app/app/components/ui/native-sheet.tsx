import * as React from "react"
import { XIcon } from "lucide-react"
import { Drawer as Vaul } from "vaul"

import { platformOf, useDeviceStyle } from "~/lib/device"
import { cn } from "~/lib/utils"
import { useDeviceClass } from "./device"

/** The half height detent, as a share of the window: what a sheet opens at when its content is taller. */
const MEDIUM = 0.6
const FULL = 1
/** Phone width, where a dialog or a settings menu is better as a sheet. */
const PHONE_QUERY = "(max-width: 699px)"
/** Above everything else on the page, players and their own menus included. */
const SHEET_Z = 2147483647

function useMedia(query: string) {
  const [matches, setMatches] = React.useState(false)
  React.useEffect(() => {
    const mql = window.matchMedia(query)
    const update = () => setMatches(mql.matches)
    update()
    mql.addEventListener("change", update)
    return () => mql.removeEventListener("change", update)
  }, [query])
  return matches
}

/** True on an iPhone or Android phone, where dialogs and some menus open as the app's sheet. */
export function useSheetsOnPhone(): boolean {
  const narrow = useMedia(PHONE_QUERY)
  return platformOf(useDeviceStyle()) !== null && narrow
}

type SheetState = {
  close: () => void
  /** At the top detent, where the sheet turns solid and runs edge to edge. */
  full: boolean
  /** The detent it rests at: a share of the window, or pixels for a sheet sized to its content. */
  snap: number | string | null
  /** A sheet whose content fits under the half detent is sized to its content instead. */
  fitTo: (height: number | null) => void
}

const SheetContext = React.createContext<SheetState | null>(null)

/** Non-null inside a native sheet, so dialog and menu parts know to render as its pieces. */
export function useNativeSheet() {
  return React.useContext(SheetContext)
}

type RootProps = {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  modal?: boolean
  children?: React.ReactNode
}

/**
 * The app's bottom sheet, with its gestures. Tall content opens at the half
 * detent; drag up for full height, down to close. Content that fits under
 * the half detent gets a sheet just its size. Built on vaul, which the web
 * already uses for its drawers.
 */
export function NativeSheet({ open: openProp, defaultOpen, onOpenChange, modal = true, children }: RootProps) {
  const [inner, setInner] = React.useState(defaultOpen ?? false)
  const open = openProp ?? inner
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (openProp === undefined) setInner(next)
      onOpenChange?.(next)
    },
    [openProp, onOpenChange],
  )

  const [fit, setFit] = React.useState<number | null>(null)
  const fitRef = React.useRef<number | null>(null)
  const [active, setActive] = React.useState<number | string | null>(MEDIUM)
  const snapPoints = fit ? [`${fit}px`] : [MEDIUM, FULL]

  const fitTo = React.useCallback((height: number | null) => {
    const was = fitRef.current
    if (was === height) return
    fitRef.current = height
    setFit(height)
    // Only a change of shape moves the sheet; a resize that keeps it tall leaves the detent the user picked.
    if (height !== null) setActive(`${height}px`)
    else if (was !== null) setActive(MEDIUM)
  }, [])

  // Like a native sheet, it opens again at its first detent rather than where it was left.
  React.useEffect(() => {
    if (open) setActive(fitRef.current !== null ? `${fitRef.current}px` : MEDIUM)
  }, [open])

  const state = React.useMemo<SheetState>(
    () => ({ close: () => setOpen(false), full: active === FULL, snap: active, fitTo }),
    [setOpen, active, fitTo],
  )

  return (
    <Vaul.Root
      open={open}
      onOpenChange={setOpen}
      modal={modal}
      snapPoints={snapPoints}
      activeSnapPoint={active}
      setActiveSnapPoint={setActive}
      fadeFromIndex={0}
    >
      <SheetContext.Provider value={state}>{children}</SheetContext.Provider>
    </Vaul.Root>
  )
}

export const NativeSheetTrigger = Vaul.Trigger
export const NativeSheetClose = Vaul.Close

type ContentProps = Omit<React.ComponentProps<typeof Vaul.Content>, "title"> & {
  /** Shown as the sheet's title row with a close button, like the app's sheets. */
  title?: React.ReactNode
  /** Classes for the scrolling body that holds the children. */
  bodyClassName?: string
  showClose?: boolean
  /** Render inside this element instead of document.body (a fullscreen player). */
  container?: HTMLElement | null
  /**
   * For content that scrolls itself and keeps a bar at its foot (comments and
   * their composer): the body takes exactly the visible part of the sheet at
   * each detent, so that bar never sits below the screen at the half detent.
   */
  fill?: boolean
  /** Extra buttons in the title row, before the close button. */
  actions?: React.ReactNode
}

export const NativeSheetContent = React.forwardRef<HTMLDivElement, ContentProps>(function NativeSheetContent(
  { title, bodyClassName, showClose = true, container, fill = false, actions, children, className, style, ...props },
  ref,
) {
  const sheet = useNativeSheet()
  const device = useDeviceStyle()
  const material = platformOf(device) === "material"
  const glass = device === "ios-glass"
  // A phone the device check couldn't place still gets a sheet's shape.
  const frame = useDeviceClass("sheetFrame") || "rounded-t-2xl"
  const grabber = useDeviceClass("grabber") || "top-2 h-1.5 w-10 bg-muted-foreground/30"
  // Measured as soon as the content attaches (the portal only renders it after
  // mounting), so a short sheet opens straight at its own height.
  const fitTo = sheet?.fitTo
  // Room left above the sheet at full height; detents count from the window's top, so it is part of the fit.
  const gap = material ? 16 : 10
  const measured = React.useCallback(
    (el: HTMLDivElement | null) => {
      if (!el || !fitTo) return
      if (fill) {
        fitTo(null)
        return
      }
      const measure = () => {
        const need = Math.ceil(el.getBoundingClientRect().height) + gap
        fitTo(need > gap && need <= window.innerHeight * MEDIUM ? need : null)
      }
      measure()
      const observer = new ResizeObserver(measure)
      observer.observe(el)
      return () => observer.disconnect()
    },
    [fitTo, gap, fill],
  )
  // The part of the sheet on screen at its detent: the rest hangs below the window.
  const snap = sheet?.snap
  const visible =
    typeof snap === "number"
      ? `calc(${snap * 100}dvh - env(safe-area-inset-top) - ${gap}px)`
      : typeof snap === "string"
        ? `calc(${snap} - ${gap}px)`
        : undefined

  // Glass while it floats at a lower detent, solid and edge to edge at full height, as on iOS 26.
  const floating = glass && !sheet?.full
  const full = Boolean(sheet?.full)
  const frameRef = React.useRef<HTMLDivElement>(null)

  // At full height the lists inside scroll. One sitting at its top lets a pull
  // down go to the sheet instead (pan-up leaves only upward scrolling to the
  // browser), so the sheet can be dragged from anywhere there too.
  React.useEffect(() => {
    const frame = frameRef.current
    if (!frame || !full || typeof CSS === "undefined" || !CSS.supports("touch-action", "pan-up")) return
    const settle = (el: HTMLElement) => {
      el.style.touchAction = el.scrollTop <= 0 ? "pan-up" : "pan-y"
    }
    const scrollers = () =>
      [...frame.querySelectorAll<HTMLElement>("*")].filter((el) => {
        const overflow = getComputedStyle(el).overflowY
        return (overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight
      })
    scrollers().forEach(settle)
    const onScroll = (e: Event) => {
      if (e.target instanceof HTMLElement && frame.contains(e.target)) settle(e.target)
    }
    frame.addEventListener("scroll", onScroll, true)
    return () => {
      frame.removeEventListener("scroll", onScroll, true)
      scrollers().forEach((el) => {
        el.style.touchAction = ""
      })
    }
  }, [full])

  return (
    <Vaul.Portal container={container ?? undefined}>
      <Vaul.Overlay className="fixed inset-0 bg-black/40" style={{ zIndex: SHEET_Z - 1 }} />
      <Vaul.Content
        ref={ref}
        aria-describedby={undefined}
        className={cn("fixed inset-x-0 bottom-0 flex flex-col outline-none", className)}
        style={{
          ...style,
          zIndex: SHEET_Z,
          height: `calc(100dvh - env(safe-area-inset-top) - ${gap}px)`,
        }}
        {...props}
      >
        <div
          ref={frameRef}
          className={cn(
            "absolute inset-y-0 flex flex-col overflow-hidden bg-background text-foreground transition-[left,right,background-color] duration-300 ease-out",
            floating ? "inset-x-2 bg-background/75 backdrop-blur-2xl backdrop-saturate-150" : "inset-x-0",
            // Below full height the whole sheet is its handle, as in the app: the
            // browser pans nothing inside it, so a drag anywhere moves the sheet.
            full ? "[&_*]:overscroll-y-none" : "touch-none [&_*]:touch-none",
            frame,
          )}
        >
          <div aria-hidden className={cn("pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 rounded-full", grabber)} />
          <div
            ref={measured}
            className={cn("flex max-h-full min-h-0 flex-col", fill && "transition-[height] duration-300 ease-out")}
            style={fill ? { height: visible } : undefined}
          >
            {title ? (
              <div className="flex shrink-0 items-center gap-1 pt-6 pr-2 pb-2 pl-5">
                <Vaul.Title className="min-w-0 flex-1 truncate text-[17px] font-semibold">{title}</Vaul.Title>
                {actions}
                {showClose ? (
                  <Vaul.Close className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted active:bg-muted" aria-label="Close">
                    <XIcon className="size-[18px]" />
                  </Vaul.Close>
                ) : null}
              </div>
            ) : showClose ? (
              <Vaul.Close
                className="absolute top-4 right-4 z-10 flex size-8 items-center justify-center rounded-full bg-muted/80 text-muted-foreground transition-colors hover:bg-muted active:bg-muted"
                aria-label="Close"
              >
                <XIcon className="size-4" />
              </Vaul.Close>
            ) : null}
            <div
              className={cn(
                fill
                  ? "flex min-h-0 flex-1 flex-col"
                  : "min-h-0 overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)+16px)]",
                !title && "pt-6",
                bodyClassName,
              )}
            >
              {children}
            </div>
          </div>
        </div>
      </Vaul.Content>
    </Vaul.Portal>
  )
})

/** The sheet's title, for content that brings its own header (a dialog's). */
export const NativeSheetTitle = Vaul.Title
export const NativeSheetDescription = Vaul.Description
