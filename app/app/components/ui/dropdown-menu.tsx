import * as React from "react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"
import { CheckIcon, ChevronDownIcon, CircleIcon } from "lucide-react"

import { cn } from "~/lib/utils"

/**
 * Live narrow-viewport hook for positioning defaults. Self-contained so the
 * dropdown library has zero context dependency (callable from any tree). Reads
 * matchMedia synchronously on mount to avoid one-frame placement flicker.
 */
const NARROW_QUERY = "(max-width: 899px)"

function useIsNarrowViewport() {
  const [narrow, setNarrow] = React.useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
    return window.matchMedia(NARROW_QUERY).matches
  })
  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const mql = window.matchMedia(NARROW_QUERY)
    const handler = () => setNarrow(mql.matches)
    mql.addEventListener("change", handler)
    setNarrow(mql.matches)
    return () => mql.removeEventListener("change", handler)
  }, [])
  return narrow
}

function DropdownMenu({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return (
    <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
  )
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...props}
    />
  )
}

const DROPDOWN_MENU_CONTENT_Z = 21474933648

/**
 * Loose, side-aware defaults. Bottom gets extra room for browser chrome / iOS home
 * indicator; left/right respect safe-area-style padding even on rooted Android. The
 * numbers are larger than Radix's default 0 because users often crash into the edge
 * on narrow screens, which makes the menu feel clipped even when it technically isn't.
 */
const COLLISION_PADDING_NARROW = { top: 12, right: 12, bottom: 28, left: 12 }
const COLLISION_PADDING_WIDE = 16

const panelFrame =
  "flex min-h-0 flex-col max-w-[min(28rem,calc(100vw-1rem-env(safe-area-inset-left)-env(safe-area-inset-right)))] min-w-[min(100%,14rem)] overflow-hidden rounded-xl border border-border bg-background/95 p-1.5 text-popover-foreground shadow-xl shadow-black/20 ring-1 ring-black/5 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:duration-150 data-[state=open]:duration-200 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"

/** Root dropdown: prefers menu viewport vars from Radix, falls back to Popper height. */
const contentBase = cn(
  panelFrame,
  "origin-[var(--radix-dropdown-menu-content-transform-origin)]",
  "max-h-[min(var(--radix-dropdown-menu-content-available-height,var(--radix-popper-available-height,85dvh)),calc(100dvh-2rem-env(safe-area-inset-bottom)))]",
)

const scrollBody =
  "min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"

function DropdownMenuContent({
  className,
  sideOffset = 6,
  collisionPadding,
  align,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  const isNarrow = useIsNarrowViewport()
  // On narrow viewports we bias toward `end` alignment so the menu hugs the right
  // edge of a trigger that's already near the right side of the screen  Radix will
  // still flip via `avoidCollisions` if that doesn't fit.
  const resolvedAlign = align ?? (isNarrow ? "end" : undefined)
  const resolvedCollisionPadding =
    collisionPadding ?? (isNarrow ? COLLISION_PADDING_NARROW : COLLISION_PADDING_WIDE)
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        align={resolvedAlign}
        collisionPadding={resolvedCollisionPadding}
        sticky="always"
        updatePositionStrategy="always"
        hideWhenDetached
        avoidCollisions
        style={{ zIndex: DROPDOWN_MENU_CONTENT_Z }}
        className={cn(contentBase, className)}
        {...props}
      >
        <div className={scrollBody}>{children}</div>
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return (
    <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        // Bigger min-height on coarse pointers (phones/tablets) per WCAG 2.5.5
        // touch target guidance, normal density on hover-capable inputs.
        "relative flex cursor-default items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-hidden select-none transition-colors duration-150 ease-out focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/15 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive [&_svg:not([class*='text-'])]:text-muted-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [@media(pointer:coarse)]:min-h-[2.5rem] [@media(pointer:coarse)]:py-2.5",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-lg py-2 pr-2.5 pl-8 text-sm outline-hidden select-none transition-colors duration-150 ease-out focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [@media(pointer:coarse)]:min-h-[2.5rem] [@media(pointer:coarse)]:py-2.5",
        className
      )}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return (
    <DropdownMenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-lg py-2 pr-2.5 pl-8 text-sm outline-hidden select-none transition-colors duration-150 ease-out focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [@media(pointer:coarse)]:min-h-[2.5rem] [@media(pointer:coarse)]:py-2.5",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CircleIcon className="size-2 fill-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  )
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "px-2.5 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground data-[inset]:pl-8",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-0.5 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

/**
 * Expand/collapse section inside an open dropdown (replaces submenu flyouts for long lists).
 * Pair trigger + content; trigger uses a menu item shell so keyboard nav and dismissal match other rows.
 */
function DropdownMenuCollapsible({
  onOpenChange,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const scrollFallbackTimerRef = React.useRef<number | null>(null)

  React.useEffect(
    () => () => {
      if (scrollFallbackTimerRef.current !== null) {
        window.clearTimeout(scrollFallbackTimerRef.current)
      }
    },
    [],
  )

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      onOpenChange?.(next)
      if (!next || typeof window === "undefined") return

      const el = rootRef.current
      if (!el) return

      const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth"
      const scroll = () => {
        el.scrollIntoView({
          behavior,
          block: "nearest",
          inline: "nearest",
        })
      }

      scroll()
      window.requestAnimationFrame(() => window.requestAnimationFrame(scroll))

      if (scrollFallbackTimerRef.current !== null) {
        window.clearTimeout(scrollFallbackTimerRef.current)
      }
      scrollFallbackTimerRef.current = window.setTimeout(() => {
        scroll()
        scrollFallbackTimerRef.current = null
      }, 220)
    },
    [onOpenChange],
  )

  return (
    <CollapsiblePrimitive.Root
      ref={rootRef}
      data-slot="dropdown-menu-collapsible"
      {...props}
      onOpenChange={handleOpenChange}
    />
  )
}

function DropdownMenuCollapsibleTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuItem asChild inset={inset} onSelect={(event) => event.preventDefault()} className="px-0">
      <CollapsiblePrimitive.CollapsibleTrigger
        data-slot="dropdown-menu-collapsible-trigger"
        type="button"
        className={cn(
          "flex min-h-0 w-full min-w-0 cursor-default items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm outline-hidden select-none transition-colors duration-150 ease-out focus-visible:bg-accent focus-visible:text-accent-foreground hover:bg-accent/80 data-[state=open]:bg-accent data-[state=open]:text-accent-foreground data-[state=open]:[&_.dropdown-menu-collapsible-chevron]:rotate-180 [&_svg:not([class*='text-'])]:text-muted-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [@media(pointer:coarse)]:min-h-[2.5rem] [@media(pointer:coarse)]:py-2.5 motion-reduce:transition-none",
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon
          aria-hidden
          className="dropdown-menu-collapsible-chevron ml-auto size-4 shrink-0 rotate-0 opacity-70 transition-transform duration-200 ease-out motion-reduce:transition-none"
        />
      </CollapsiblePrimitive.CollapsibleTrigger>
    </DropdownMenuItem>
  )
}

function DropdownMenuCollapsibleContent({
  className,
  flush,
  children,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent> & {
  /** Full-width inset (no left rule); use for dense lists like playlists. */
  flush?: boolean
}) {
  return (
    <CollapsiblePrimitive.CollapsibleContent
      data-slot="dropdown-menu-collapsible-content"
      className={cn(
        "motion-reduce:transition-none",
        "grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out",
        "grid-rows-[0fr] data-[state=open]:grid-rows-[1fr]",
        className,
      )}
      {...props}
    >
      <div className="min-h-0">
        <div
          className={
            flush
              ? "min-h-0 w-full py-1"
              : "mr-px space-y-0.5 border-l border-border/50 py-1 pl-2 ml-7"
          }
        >
          {children}
        </div>
      </div>
    </CollapsiblePrimitive.CollapsibleContent>
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuCollapsible,
  DropdownMenuCollapsibleTrigger,
  DropdownMenuCollapsibleContent,
}
