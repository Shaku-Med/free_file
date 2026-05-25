/**
 * Lightweight check for adult/sensitive language in title or description.
 * Used only to set metadata.warning when content (is_adult) is false but text may be NSFW.
 * Does NOT determine is_adult status  that comes from content (e.g. vision/Go).
 */

const NSFW_WORDS = new Set([
  'nsfw', 'xxx', 'porn', 'porno', 'onlyfans', 'only fans', 'nude', 'nudes', 'naked',
  'sex', 'sexual', 'erotic', 'erotica', 'adult only', '18+', 'explicit',
]);

function normalizeForCheck(text: string): string {
  return (text || '').toLowerCase().trim();
}

function getWords(text: string): string[] {
  return normalizeForCheck(text).split(/\s+/).filter(Boolean);
}

/**
 * Returns true if the text appears to contain adult/sensitive language.
 * Conservative: only flags when a known term is present as a whole word (or phrase).
 */
export function textContainsNsfw(text: string | null | undefined): boolean {
  if (!text || typeof text !== 'string') return false;
  const normalized = normalizeForCheck(text);
  const words = getWords(text);
  for (const word of words) {
    if (NSFW_WORDS.has(word)) return true;
  }
  for (const phrase of NSFW_WORDS) {
    if (phrase.includes(' ') && normalized.includes(phrase)) return true;
  }
  return false;
}

export const DEFAULT_METADATA_WARNING =
  'Title or description may contain adult or sensitive language. The media itself is not marked as adult.';
