import { platformOf, useDeviceStyle } from "~/lib/device";

/**
 * How each piece looks on a phone, so the web matches the app there: iOS
 * shapes and type on iPhone (rounder still with Liquid Glass), Material on
 * Android. Desktop keeps the web's own look. Only shape, surface and type
 * change, never size, so no page's layout moves. A component puts these
 * before its caller's classes, so a page that styles a piece itself still wins.
 */
type Look = { ios?: string; glass?: string; material?: string };

const LOOKS = {
  button: {
    ios: "rounded-full font-semibold",
    material: "rounded-full font-medium tracking-[0.01em]",
  },
  field: {
    ios: "rounded-xl border-transparent bg-muted shadow-none text-[17px] md:text-[17px] dark:bg-muted",
    material: "rounded-[4px] border-muted-foreground/50 shadow-none text-base md:text-base focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary",
  },
  menuContent: {
    ios: "rounded-[14px] border-0 p-0 shadow-2xl shadow-black/25 ring-0 [&_[role^=menuitem]+[role^=menuitem]]:border-t [&_[role^=menuitem]+[role^=menuitem]]:border-border/60",
    glass: "rounded-[26px] p-1.5 [&_[role^=menuitem]+[role^=menuitem]]:border-t-0",
    material: "rounded-[4px] border-0 px-0 py-2 shadow-lg shadow-black/20 ring-0",
  },
  menuItem: {
    ios: "gap-3 rounded-none px-4 py-[11px] text-[17px] leading-[22px] focus:bg-foreground/10 [&_svg:not([class*='size-'])]:size-5",
    glass: "rounded-[14px]",
    material: "h-12 gap-3 rounded-none px-3 py-0 text-sm focus:bg-foreground/10 [@media(pointer:coarse)]:min-h-12 [&_svg:not([class*='size-'])]:size-5",
  },
  /** Checkbox and radio rows keep their left room for the tick. */
  menuCheckItem: {
    ios: "gap-3 rounded-none py-[11px] pr-4 text-[17px] leading-[22px] focus:bg-foreground/10",
    glass: "rounded-[14px]",
    material: "h-12 gap-3 rounded-none py-0 pr-3 text-sm focus:bg-foreground/10 [@media(pointer:coarse)]:min-h-12",
  },
  menuLabel: {
    ios: "px-4 py-2 text-[13px] font-normal normal-case tracking-normal",
    material: "px-3 py-2 text-sm font-medium normal-case tracking-normal",
  },
  menuSeparator: {
    ios: "mx-0 my-0 h-1.5 bg-foreground/[0.06]",
    glass: "mx-3 my-1 h-px bg-border",
    material: "mx-0 my-2 h-px bg-border",
  },
  popover: {
    ios: "rounded-[14px] border-0 shadow-2xl shadow-black/25",
    glass: "rounded-[26px] bg-popover/80 backdrop-blur-2xl backdrop-saturate-150",
    material: "rounded-xl border-0 shadow-lg shadow-black/20",
  },
  /** Phones have no hover, so a tooltip only ever shows up stuck after a tap. */
  tooltip: {
    ios: "hidden",
    material: "hidden",
  },
  tabsList: {
    ios: "rounded-[9px] p-[2px]",
    glass: "rounded-full",
    material: "rounded-full border border-border bg-transparent p-0",
  },
  tabsTrigger: {
    ios: "rounded-[7px] text-[13px] data-[state=active]:shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)] dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-muted-foreground/40",
    glass: "rounded-full",
    material: "rounded-full data-[state=active]:bg-primary/15 data-[state=active]:shadow-none dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-primary/25",
  },
  switch: {
    ios: "border-0 shadow-none data-[size=default]:h-[31px] data-[size=default]:w-[51px] data-[state=unchecked]:bg-muted-foreground/25 dark:data-[state=unchecked]:bg-muted-foreground/35",
    material: "border-2 shadow-none data-[size=default]:h-8 data-[size=default]:w-[52px] data-[state=checked]:border-primary data-[state=unchecked]:border-muted-foreground/70 data-[state=unchecked]:bg-muted dark:data-[state=unchecked]:bg-muted",
  },
  switchThumb: {
    ios: "bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.16)] group-data-[size=default]/switch:size-[27px] data-[state=checked]:translate-x-[22px] data-[state=unchecked]:translate-x-[2px] dark:data-[state=checked]:bg-white dark:data-[state=unchecked]:bg-white",
    material: "group-data-[size=default]/switch:size-4 group-data-[size=default]/switch:data-[state=checked]:size-6 data-[state=checked]:translate-x-[22px] data-[state=unchecked]:translate-x-[6px] data-[state=checked]:bg-primary-foreground data-[state=unchecked]:bg-muted-foreground dark:data-[state=checked]:bg-primary-foreground dark:data-[state=unchecked]:bg-muted-foreground",
  },
  sliderTrack: {
    ios: "h-1 bg-muted-foreground/25",
    material: "h-1 bg-primary/25",
  },
  sliderThumb: {
    ios: "size-7 border-0 bg-white shadow-[0_0.5px_4px_rgba(0,0,0,0.12),0_6px_13px_rgba(0,0,0,0.12)]",
    material: "size-5 border-0 bg-primary",
  },
  progress: {
    ios: "h-1 bg-muted-foreground/20",
    material: "h-1 bg-primary/25",
  },
  /** A dialog on a phone is the app's sheet: a gap at the top, rounded top corners, run to the bottom edge. */
  dialog: {
    ios: "max-sm:!top-[calc(env(safe-area-inset-top)+var(--app-vv-top,0px)+10px)] max-sm:!h-[calc(var(--app-vvh,100dvh)-env(safe-area-inset-top)-10px)] max-sm:!rounded-t-[12px] max-sm:!border-transparent max-sm:!border-b-[length:env(safe-area-inset-bottom)] max-sm:data-[state=open]:slide-in-from-bottom max-sm:data-[state=closed]:slide-out-to-bottom",
    glass: "max-sm:!rounded-t-[38px]",
    material: "max-sm:!top-[calc(env(safe-area-inset-top)+var(--app-vv-top,0px)+16px)] max-sm:!h-[calc(var(--app-vvh,100dvh)-env(safe-area-inset-top)-16px)] max-sm:!rounded-t-[28px] max-sm:!border-transparent max-sm:!border-b-[length:env(safe-area-inset-bottom)] max-sm:data-[state=open]:slide-in-from-bottom max-sm:data-[state=closed]:slide-out-to-bottom",
  },
  /** The grabber on top of a sheet: iOS's short pill, Material's drag handle. */
  grabber: {
    ios: "top-[5px] h-[5px] w-9 bg-muted-foreground/40",
    material: "top-4 h-1 w-8 bg-muted-foreground/40",
  },
  /** The drawer's own handle, which sits in the flow above its content. */
  drawerHandle: {
    ios: "mt-[5px] h-[5px] w-9 bg-muted-foreground/40",
    material: "mt-4 h-1 w-8 bg-muted-foreground/40",
  },
  drawer: {
    ios: "data-[vaul-drawer-direction=bottom]:rounded-t-[12px] data-[vaul-drawer-direction=bottom]:border-t-0",
    glass: "data-[vaul-drawer-direction=bottom]:rounded-t-[38px]",
    material: "data-[vaul-drawer-direction=bottom]:rounded-t-[28px] data-[vaul-drawer-direction=bottom]:border-t-0",
  },
  bottomSheet: {
    ios: "rounded-t-[12px] border-t-0",
    glass: "rounded-t-[38px]",
    material: "rounded-t-[28px] border-t-0",
  },
  /** Android's navigation drawer rounds its open edge; iOS has no side drawer of its own. */
  sideSheet: {
    material: "border-0 rounded-e-2xl",
  },
  toast: {
    ios: "rounded-[22px]",
    material: "rounded-[4px] group-[.toaster]:bg-foreground group-[.toaster]:text-background group-[.toaster]:border-transparent",
  },
} satisfies Record<string, Look>;

export type DevicePart = keyof typeof LOOKS;

/** The classes for `part` on this device, or "" on desktop. */
export function useDeviceClass(part: DevicePart): string {
  const style = useDeviceStyle();
  const look: Look = LOOKS[part];
  const platform = platformOf(style);
  if (platform === "material") return look.material ?? "";
  if (platform === "ios") return [look.ios, style === "ios-glass" ? look.glass : undefined].filter(Boolean).join(" ");
  return "";
}

/** True on a phone or tablet platform, for pieces that only exist there (a sheet's grabber). */
export function useOnDevicePlatform(): boolean {
  return platformOf(useDeviceStyle()) !== null;
}
