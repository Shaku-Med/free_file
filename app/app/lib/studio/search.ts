export const STUDIO_SEARCH_MAX = 100;

/**
 * Letters, numbers, spaces and a little punctuation, nothing else. The server
 * drops the result into a quoted PostgREST filter, so quotes, commas, colons
 * and brackets must never get through.
 */
export function cleanStudioSearch(raw: string): string {
  return raw
    .slice(0, STUDIO_SEARCH_MAX * 2)
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s._'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, STUDIO_SEARCH_MAX)
    .trim();
}
