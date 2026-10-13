const OPEN_EVENT = "memories:open-header-search";

/** Opens the header's search field from elsewhere, like the Search tab. */
export function openHeaderSearch() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function onOpenHeaderSearch(listener: () => void): () => void {
  window.addEventListener(OPEN_EVENT, listener);
  return () => window.removeEventListener(OPEN_EVENT, listener);
}
