/**
 * Channel home layout: the creator's arranged channel page (YouTube-Studio
 * style). Shared by the layout API, the Studio editor, and the public profile
 * page so the shape and validation live in exactly one place.
 */

export const CHANNEL_SECTION_TYPES = ['shorts', 'videos', 'popular', 'playlists'] as const;
export type ChannelSectionType = (typeof CHANNEL_SECTION_TYPES)[number];

export interface ChannelSection {
  type: ChannelSectionType;
  visible: boolean;
}

export interface ChannelLayout {
  sections: ChannelSection[];
}

/** Hard ceiling, mirrors YouTube's "up to 12 sections". */
export const MAX_SECTIONS = 12;

export const SECTION_LABELS: Record<ChannelSectionType, string> = {
  shorts: 'Shorts',
  videos: 'Videos',
  popular: 'Popular videos',
  playlists: 'Playlists',
};

export const SECTION_DESCRIPTIONS: Record<ChannelSectionType, string> = {
  shorts: 'Your reels, newest first.',
  videos: 'Your uploads, newest first.',
  popular: 'Your most-viewed videos.',
  playlists: 'Playlists you created.',
};

export const DEFAULT_CHANNEL_LAYOUT: ChannelLayout = {
  sections: CHANNEL_SECTION_TYPES.map((type) => ({ type, visible: true })),
};

function isSectionType(v: unknown): v is ChannelSectionType {
  return typeof v === 'string' && (CHANNEL_SECTION_TYPES as readonly string[]).includes(v);
}

/**
 * Normalize anything (DB jsonb, API body) into a valid ChannelLayout:
 * de-dupes section types, drops unknown types, caps at MAX_SECTIONS, then
 * APPENDS any missing known types (hidden) so the editor always lists them.
 * Accepts both camelCase and snake_case id keys.
 */
export function sanitizeChannelLayout(raw: unknown): ChannelLayout {
  if (!raw || typeof raw !== 'object') return cloneDefault();
  const obj = raw as Record<string, unknown>;

  const seen = new Set<ChannelSectionType>();
  const sections: ChannelSection[] = [];
  if (Array.isArray(obj.sections)) {
    for (const entry of obj.sections) {
      if (!entry || typeof entry !== 'object') continue;
      const type = (entry as Record<string, unknown>).type;
      if (!isSectionType(type) || seen.has(type)) continue;
      seen.add(type);
      sections.push({ type, visible: (entry as Record<string, unknown>).visible !== false });
      if (sections.length >= MAX_SECTIONS) break;
    }
  }
  // Always surface every known type (newly added ones land hidden-but-present
  // so the editor can show a toggle for them).
  for (const type of CHANNEL_SECTION_TYPES) {
    if (!seen.has(type) && sections.length < MAX_SECTIONS) {
      sections.push({ type, visible: true });
      seen.add(type);
    }
  }

  return { sections };
}

function cloneDefault(): ChannelLayout {
  return { sections: DEFAULT_CHANNEL_LAYOUT.sections.map((s) => ({ ...s })) };
}
