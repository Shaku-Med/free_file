import db from "~/lib/Database/supabase";

// One place to call the report RPCs. All callers are auth-required server
// routes; the RPCs themselves are SECURITY DEFINER service_role-only.

export type ReportTargetType = "file" | "comment" | "user";

export const REPORT_REASONS = [
  "spam",
  "nsfw_unmarked",
  "harassment",
  "hate",
  "violence",
  "self_harm",
  "child_safety",
  "copyright",
  "impersonation",
  "scam",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export interface SubmitReportResult {
  ok: boolean;
  already?: boolean;
  error?:
    | "invalid"
    | "invalid_target_type"
    | "invalid_reason"
    | "not_found"
    | "self_report"
    | "rate_limited"
    | "db_error";
}

export async function submitReport(
  reporterId: string,
  targetType: ReportTargetType,
  targetId: string,
  reason: ReportReason,
  details: string | null,
): Promise<SubmitReportResult> {
  if (!db) return { ok: false, error: "db_error" };
  try {
    const { data, error } = await db.rpc("submit_report", {
      p_reporter_id: reporterId,
      p_target_type: targetType,
      p_target_id: targetId,
      p_reason: reason,
      p_details: details,
    });
    if (error) {
      console.error("[reports] submit rpc:", error.message ?? error);
      return { ok: false, error: "db_error" };
    }
    const r = (data ?? {}) as Record<string, unknown>;
    if (r.ok === true) {
      return { ok: true, already: r.already === true };
    }
    return { ok: false, error: (r.error as SubmitReportResult["error"]) ?? "invalid" };
  } catch (e) {
    console.error("[reports] submit threw:", e);
    return { ok: false, error: "db_error" };
  }
}

export async function getReportStatus(
  reporterId: string,
  targetType: ReportTargetType,
  targetId: string,
): Promise<{ reported: boolean }> {
  if (!db) return { reported: false };
  try {
    const { data, error } = await db.rpc("get_report_status", {
      p_reporter_id: reporterId,
      p_target_type: targetType,
      p_target_id: targetId,
    });
    if (error) return { reported: false };
    const r = (data ?? {}) as Record<string, unknown>;
    return { reported: r.reported === true };
  } catch {
    return { reported: false };
  }
}
