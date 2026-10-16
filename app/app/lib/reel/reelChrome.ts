import { useEffect, useSyncExternalStore } from "react";
import { useIsMobile } from "~/hooks/use-mobile";
import { useTabBarStyle } from "~/lib/hooks/useTabBarStyle";

/**
 * The phone reel page draws the app's header (new post, Reels and Following,
 * sound and settings) in the navbar, while the controls it drives live in the
 * active reel's player. This module is the small bridge between the two.
 */

export type ReelFeedMode = "reels" | "following";
export type ReelCommand = "settings" | "mute";

const COMMAND_EVENT = "memories:reel-command";

function createValue<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      if (Object.is(next, value)) return;
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const feedMode = createValue<ReelFeedMode>("reels");
const muted = createValue(false);

export const setReelFeedMode = (mode: ReelFeedMode) => feedMode.set(mode);
export const useReelFeedMode = () => useSyncExternalStore(feedMode.subscribe, feedMode.get, () => "reels" as const);

/** The active reel reports its sound so the header's speaker icon is right. */
export const setReelMuted = (value: boolean) => muted.set(value);
export const useReelMuted = () => useSyncExternalStore(muted.subscribe, muted.get, () => false);

export function sendReelCommand(command: ReelCommand) {
  window.dispatchEvent(new CustomEvent<ReelCommand>(COMMAND_EVENT, { detail: command }));
}

/** Runs `handler` for header commands, only while `active` (the reel on screen). */
export function useReelCommand(active: boolean, handler: (command: ReelCommand) => void) {
  useEffect(() => {
    if (!active) return;
    const listener = (e: Event) => {
      const command = (e as CustomEvent<ReelCommand>).detail;
      if (command === "settings" || command === "mute") handler(command);
    };
    window.addEventListener(COMMAND_EVENT, listener);
    return () => window.removeEventListener(COMMAND_EVENT, listener);
  }, [active, handler]);
}

/** Phones in an app-style shell get the app's reel header; desktop keeps the player's own top row. */
export function useAppReelChrome(): boolean {
  const style = useTabBarStyle();
  const isMobile = useIsMobile();
  return isMobile && style !== "default";
}
