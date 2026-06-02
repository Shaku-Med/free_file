import { isAuthenticated } from "~/lib/Security/Password";
import {
  submitReport,
  getReportStatus,
  REPORT_REASONS,
  type ReportReason,
  type ReportTargetType,
} from "~/lib/reports.server";
import { isValidUUID } from "~/lib/Security/inputValidation";

const TARGETS = new Set<ReportTargetType>(["file", "comment", "user"]);
const REASONS = new Set<ReportReason>(REPORT_REASONS);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

// GET /api/reports?target_type=...&target_id=...  has the signed-in user
// already reported this target? Lets the UI show a "Reported" pill.
export const loader = async ({ request }: { request: Request }) => {
  const user = await isAuthenticated(request, ["id"]).catch(() => null);
  const userId = user && typeof user !== "boolean" ? user.id : null;
  if (!userId) return json({ error: "unauthorized" }, 401);

  const url = new URL(request.url);
  const targetType = url.searchParams.get("target_type") as ReportTargetType | null;
  const targetId = url.searchParams.get("target_id");
  if (!targetType || !TARGETS.has(targetType)) return json({ error: "invalid" }, 400);
  if (!targetId || targetId.length > 128) return json({ error: "invalid" }, 400);

  const { reported } = await getReportStatus(userId, targetType, targetId);
  return json({ reported });
};

// POST /api/reports  submit a report. Body: { target_type, target_id, reason, details? }
export const action = async ({ request }: { request: Request }) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const user = await isAuthenticated(request, ["id"]).catch(() => null);
  const userId = user && typeof user !== "boolean" ? user.id : null;
  if (!userId || !isValidUUID(userId)) return json({ error: "unauthorized" }, 401);

  let body: { target_type?: unknown; target_id?: unknown; reason?: unknown; details?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const targetType = body.target_type as ReportTargetType | undefined;
  const targetId = typeof body.target_id === "string" ? body.target_id.trim() : "";
  const reason = body.reason as ReportReason | undefined;
  const details = typeof body.details === "string" ? body.details : null;

  if (!targetType || !TARGETS.has(targetType)) return json({ error: "invalid_target_type" }, 400);
  if (!targetId || targetId.length > 128) return json({ error: "invalid_target" }, 400);
  if (!reason || !REASONS.has(reason)) return json({ error: "invalid_reason" }, 400);

  const result = await submitReport(userId, targetType, targetId, reason, details);
  if (!result.ok) {
    // Distinct status codes so the client can show friendly copy without
    // parsing the error string.
    if (result.error === "rate_limited") return json({ error: result.error }, 429);
    if (result.error === "self_report") return json({ error: result.error }, 403);
    if (result.error === "not_found") return json({ error: result.error }, 404);
    return json({ error: result.error ?? "invalid" }, 400);
  }
  return json({ ok: true, already: result.already === true });
};
