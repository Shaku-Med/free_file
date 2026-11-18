import db from "~/lib/Database/supabase";

export type DailyEventRow = { event_type: string; day: string; count: number };

type AnalyticsSchemaState = "unknown" | "ready" | "missing";

const schemaGlobal = globalThis as typeof globalThis & {
  __studioAnalyticsSchema?: AnalyticsSchemaState;
};

function getSchemaState(): AnalyticsSchemaState {
  return schemaGlobal.__studioAnalyticsSchema ?? "unknown";
}

function setSchemaState(state: AnalyticsSchemaState) {
  schemaGlobal.__studioAnalyticsSchema = state;
}

function isMissingAnalyticsSchema(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("analytics_daily_per_owner") ||
    m.includes("analytics_daily_per_file") ||
    m.includes("analytics_events") ||
    m.includes("schema cache")
  );
}

/** Cached probe — false when analytics_events has not been created in Supabase yet. */
export async function isAnalyticsSchemaAvailable(): Promise<boolean> {
  const cached = getSchemaState();
  if (cached === "ready") return true;
  if (cached === "missing") return false;
  if (!db) {
    setSchemaState("missing");
    return false;
  }

  const probe = await db.from("analytics_events").select("id").limit(1);
  if (!probe.error) {
    setSchemaState("ready");
    return true;
  }
  if (isMissingAnalyticsSchema(probe.error.message ?? "")) {
    setSchemaState("missing");
    return false;
  }

  setSchemaState("ready");
  return true;
}

function aggregateRawEvents(
  rows: Array<{ event_type: string; occurred_at: string }>,
  sinceDay: string,
): DailyEventRow[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const day = row.occurred_at?.slice(0, 10);
    if (!day || day < sinceDay) continue;
    const key = `${row.event_type}\0${day}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const out: DailyEventRow[] = [];
  for (const [key, count] of counts) {
    const sep = key.indexOf("\0");
    out.push({
      event_type: key.slice(0, sep),
      day: key.slice(sep + 1),
      count,
    });
  }
  return out;
}

/** Daily rollups for an owner. Uses the SQL view when present, else aggregates raw events. */
export async function fetchOwnerDailyEvents(
  ownerId: string,
  sinceDay: string,
): Promise<DailyEventRow[]> {
  if (!db || getSchemaState() === "missing") return [];
  if (!(await isAnalyticsSchemaAvailable())) return [];

  const viewRes = await db
    .from("analytics_daily_per_owner")
    .select("event_type, day, count")
    .eq("owner_id", ownerId)
    .gte("day", sinceDay);

  if (!viewRes.error) {
    return (viewRes.data ?? []) as DailyEventRow[];
  }

  if (!isMissingAnalyticsSchema(viewRes.error.message ?? "")) {
    console.error("[studio/analytics] owner daily view", viewRes.error);
    return [];
  }

  const tableRes = await db
    .from("analytics_events")
    .select("event_type, occurred_at")
    .eq("owner_id", ownerId)
    .gte("occurred_at", `${sinceDay}T00:00:00.000Z`);

  if (!tableRes.error) {
    return aggregateRawEvents(
      (tableRes.data ?? []) as Array<{ event_type: string; occurred_at: string }>,
      sinceDay,
    );
  }

  if (!isMissingAnalyticsSchema(tableRes.error.message ?? "")) {
    console.error("[studio/analytics] analytics_events", tableRes.error);
  } else {
    setSchemaState("missing");
  }
  return [];
}

/** Daily rollups for one file. Uses the SQL view when present, else aggregates raw events. */
export async function fetchFileDailyEvents(
  fileId: string,
  sinceDay?: string,
): Promise<DailyEventRow[]> {
  if (!db || getSchemaState() === "missing") return [];
  if (!(await isAnalyticsSchemaAvailable())) return [];

  let viewQuery = db
    .from("analytics_daily_per_file")
    .select("event_type, day, count")
    .eq("file_id", fileId);
  if (sinceDay) {
    viewQuery = viewQuery.gte("day", sinceDay);
  }
  const viewRes = await viewQuery;

  if (!viewRes.error) {
    return (viewRes.data ?? []) as DailyEventRow[];
  }

  if (!isMissingAnalyticsSchema(viewRes.error.message ?? "")) {
    console.error("[studio/post] file daily view", viewRes.error);
    return [];
  }

  let tableQuery = db
    .from("analytics_events")
    .select("event_type, occurred_at")
    .eq("file_id", fileId);
  if (sinceDay) {
    tableQuery = tableQuery.gte("occurred_at", `${sinceDay}T00:00:00.000Z`);
  }
  const tableRes = await tableQuery;

  if (!tableRes.error) {
    return aggregateRawEvents(
      (tableRes.data ?? []) as Array<{ event_type: string; occurred_at: string }>,
      sinceDay ?? "1970-01-01",
    );
  }

  if (!isMissingAnalyticsSchema(tableRes.error.message ?? "")) {
    console.error("[studio/post] analytics_events", tableRes.error);
  } else {
    setSchemaState("missing");
  }
  return [];
}

export type FileDayViews = { file_id: string; day: string; count: number };

const VIEW_PAGE = 1000;
const VIEW_MAX_PAGES = 5;

/**
 * Daily video views per file for an owner, from the per file view. Paged
 * because PostgREST caps a response at 1000 rows. Null when analytics is not
 * set up, so callers can tell "no views" from "no data".
 */
export async function fetchOwnerFileViews(
  ownerId: string,
  sinceDay: string,
  fileIds?: string[],
): Promise<FileDayViews[] | null> {
  if (!db || getSchemaState() === "missing") return null;
  if (!(await isAnalyticsSchemaAvailable())) return null;
  if (fileIds && fileIds.length === 0) return [];

  const out: FileDayViews[] = [];
  for (let page = 0; page < VIEW_MAX_PAGES; page++) {
    const from = page * VIEW_PAGE;
    let q = db
      .from("analytics_daily_per_file")
      .select("file_id, day, count")
      .eq("owner_id", ownerId)
      .eq("event_type", "video_view")
      .gte("day", sinceDay);
    if (fileIds) q = q.in("file_id", fileIds);
    const { data, error } = await q
      .order("day", { ascending: true })
      .order("file_id", { ascending: true })
      .range(from, from + VIEW_PAGE - 1);

    if (error) {
      if (!isMissingAnalyticsSchema(error.message ?? "")) {
        console.error("[studio] owner file views", error);
      }
      return null;
    }
    const rows = (data ?? []) as FileDayViews[];
    for (const r of rows) out.push({ file_id: r.file_id, day: r.day, count: Number(r.count) || 0 });
    if (rows.length < VIEW_PAGE) break;
  }
  return out;
}
