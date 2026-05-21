/**
 * Legacy export — search now lives in the navbar dropdown (`NavbarSearchBar`).
 * Kept so older imports don't break.
 */
export { NavbarSearchBar } from "./SearchDropdown/NavbarSearchBar";
export { SearchPanel } from "./SearchDropdown/SearchPanel";
export { useSearchPanel } from "./SearchDropdown/useSearchPanel";

/** @deprecated Use `NavbarSearchBar` instead. */
export function SearchModal(_props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return null;
}
