import db from "~/lib/Database/supabase";

/**
 * Record taste signals from a file onto a user's profile: bump their affinity
 * for the file's categories and its upload region. Positive delta for likes and
 * long watches, negative for "not interested". Best-effort, never throws, and
 * fire-and-forget at the call sites. Reads the user_taste RPCs added in the
 * user_taste migration, so it no-ops until that has been run.
 */
export async function recordFileTaste(userId: string, fileId: string, delta: number): Promise<void> {
  if (!userId || !fileId || !db || !delta) return;
  try {
    const { data: f, error } = await db
      .from("files")
      .select("categories, upload_country")
      .eq("id", fileId)
      .maybeSingle();
    if (error || !f) return;

    const calls: Promise<unknown>[] = [];
    const bump = (dimension: string, value: unknown) => {
      if (typeof value !== "string") return;
      const v = value.trim();
      if (!v) return;
      calls.push(
        db!.rpc("bump_user_taste", {
          p_user_id: userId,
          p_dimension: dimension,
          p_value: v,
          p_delta: delta,
        }),
      );
    };

    if (Array.isArray((f as { categories?: unknown }).categories)) {
      for (const c of (f as { categories: unknown[] }).categories) bump("category", c);
    }
    bump("region", (f as { upload_country?: unknown }).upload_country);

    if (calls.length > 0) await Promise.allSettled(calls);
  } catch {
    // taste is optional signal; swallow
  }
}
