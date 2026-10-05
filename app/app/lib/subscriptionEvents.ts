/** Fired after the viewer subscribes or unsubscribes, so lists of channels (the sidebar) refresh. */
export const SUBSCRIPTIONS_CHANGED_EVENT = "subscriptions:changed";

export function notifySubscriptionsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SUBSCRIPTIONS_CHANGED_EVENT));
}
