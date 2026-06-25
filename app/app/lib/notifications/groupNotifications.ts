/**
 * Groups a flat notification list (newest first) the way Instagram/YouTube do:
 *   1. Date sections  Today / Yesterday / This week / Earlier.
 *   2. Inside each section, AGGREGATE similar notifications  same type on the
 *      same target collapse into one stack ("Alice and 4 others liked your
 *      video"). A stack of one renders as a normal single row.
 *
 * Pure + generic so both the navbar dropdown and the full page can use it; the
 * caller's row type just needs the fields in BaseNotification.
 */

export interface BaseNotification {
  id: string;
  type: string;
  file_id: string | null;
  comment_id: string | null;
  created_at: string;
  read_at: string | null;
  users: { username: string; profile_pic: string | null } | null;
}

export interface NotificationActor {
  username: string;
  profile_pic: string | null;
}

export interface NotificationGroup<T extends BaseNotification> {
  key: string;
  type: string;
  /** Newest first. */
  items: T[];
  latest: T;
  count: number;
  /** Distinct actors, newest first (for "X and N others" + stacked avatars). */
  actors: NotificationActor[];
  unread: boolean;
}

export interface NotificationSection<T extends BaseNotification> {
  label: string;
  groups: NotificationGroup<T>[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Today / Yesterday / This week / Earlier for a timestamp. */
function sectionLabel(createdAt: string, todayStart: number): string {
  const t = startOfDay(new Date(createdAt));
  if (t >= todayStart) return "Today";
  if (t >= todayStart - DAY_MS) return "Yesterday";
  if (t >= todayStart - 6 * DAY_MS) return "This week";
  return "Earlier";
}

const SECTION_ORDER = ["Today", "Yesterday", "This week", "Earlier"];

export function groupNotifications<T extends BaseNotification>(rows: T[]): NotificationSection<T>[] {
  if (!rows.length) return [];
  // Newest first (don't assume the caller sorted).
  const sorted = [...rows].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const todayStart = startOfDay(new Date());

  // section -> (aggregation key -> group)
  const sections = new Map<string, Map<string, NotificationGroup<T>>>();

  for (const row of sorted) {
    const section = sectionLabel(row.created_at, todayStart);
    const target = row.file_id ?? row.comment_id ?? "_";
    const aggKey = `${section}|${row.type}|${target}`;

    let groups = sections.get(section);
    if (!groups) {
      groups = new Map();
      sections.set(section, groups);
    }

    const existing = groups.get(aggKey);
    if (existing) {
      existing.items.push(row);
      existing.count = existing.items.length;
      if (!row.read_at) existing.unread = true;
      const uname = row.users?.username;
      if (uname && !existing.actors.some((a) => a.username === uname)) {
        existing.actors.push({ username: uname, profile_pic: row.users?.profile_pic ?? null });
      }
    } else {
      groups.set(aggKey, {
        key: aggKey,
        type: row.type,
        items: [row],
        latest: row,
        count: 1,
        actors: row.users?.username
          ? [{ username: row.users.username, profile_pic: row.users.profile_pic ?? null }]
          : [],
        unread: !row.read_at,
      });
    }
  }

  return SECTION_ORDER.filter((s) => sections.has(s)).map((label) => ({
    label,
    groups: Array.from(sections.get(label)!.values()),
  }));
}
