import { useCallback, useRef, useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// One set of stage lights per page, held by the player that last started
// playing, so a feed of players never stacks several. Ambient mode reads it
// too and sits out while the lights are up, so the two never run together.
let owner: symbol | null = null;

export function setStageLightsOwner(next: symbol | null) {
  if (owner === next) return;
  owner = next;
  notify();
}

export const stageLightsOwner = () => owner;

const lightsOn = () => owner !== null;
const nobody = () => null;
const off = () => false;

export function useStageLightsOwner(): symbol | null {
  return useSyncExternalStore(subscribe, stageLightsOwner, nobody);
}

/** True while any player shows stage lights. */
export function useStageLightsOn(): boolean {
  return useSyncExternalStore(subscribe, lightsOn, off);
}

// Where the page wants the lights: a stacking context above its background
// and under its content, the same spot ambient mode paints in.
let slot: HTMLElement | null = null;
const getSlot = () => slot;

export function useStageLightsSlotElement(): HTMLElement | null {
  return useSyncExternalStore(subscribe, getSlot, nobody);
}

/**
 * Marks the element as the page's slot for the stage lights. A callback ref,
 * so the slot follows the page when it swaps that element for a new one.
 */
export function useStageLightsSlot<T extends HTMLElement>() {
  const mine = useRef<T | null>(null);
  return useCallback((el: T | null) => {
    const prev = mine.current;
    mine.current = el;
    if (prev === el) return;
    if (el) {
      slot = el;
      notify();
    } else if (slot === prev) {
      slot = null;
      notify();
    }
  }, []);
}
