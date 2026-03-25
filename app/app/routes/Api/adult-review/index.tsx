import { data } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";
import db from "~/lib/Database/supabase";
import { sendEmailDirectly } from "~/routes/Auth/fun/email";

const REVIEW_EMAIL = "jujubelt124@gmail.com";

export const action = async ({ request }: { request: Request }) => {
  try {
    if (request.method !== "POST") {
      return data({ success: false, error: "Method not allowed" }, { status: 405 });
    }

    const user = await isAuthenticated(request, ["id", "username", "email"]);
    if (!user?.id) {
      return data({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    if (!db) {
      return data({ success: false, error: "Database unavailable" }, { status: 500 });
    }

    const body = await request.json();
    const { file_id, reason, action: actionType } = body;

    if (!file_id) {
      return data({ success: false, error: "file_id is required" }, { status: 400 });
    }

    // Get review status
    if (actionType === "status") {
      const { data: result, error } = await db.rpc("get_adult_review_status", {
        p_user_id: user.id,
        p_file_id: file_id,
      });

      if (error) {
        console.error("get_adult_review_status error:", error);
        return data({ success: false, error: "Failed to get review status" }, { status: 500 });
      }

      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      return data({ success: true, ...parsed }, { status: 200 });
    }

    // Submit review request
    if (actionType === "submit") {
      const sanitizedReason = typeof reason === "string" ? reason.trim().slice(0, 500) : null;

      const { data: result, error } = await db.rpc("submit_adult_review_request", {
        p_user_id: user.id,
        p_file_id: file_id,
        p_reason: sanitizedReason,
      });

      if (error) {
        console.error("submit_adult_review_request error:", error);
        return data({ success: false, error: "Failed to submit review request" }, { status: 500 });
      }

      const parsed = typeof result === "string" ? JSON.parse(result) : result;

      if (!parsed.success) {
        return data(parsed, { status: 400 });
      }

      // Get file details for the email
      const { data: fileData } = await db
        .from("files")
        .select("file_title, filename, unique_id, endpoint")
        .eq("id", file_id)
        .single();

      const fileTitle = fileData?.file_title || fileData?.filename || "Unknown";
      const fileLink = fileData?.unique_id ? `${request.headers.get("origin") || ""}/${fileData.unique_id}` : "N/A";

      // Send email notification immediately
      const emailSent = await sendEmailDirectly({
        to: REVIEW_EMAIL,
        subject: `Review #${parsed.request_count} — ${fileTitle}`,
        html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family: system-ui, -apple-system, sans-serif; color: #e4e4e7; background: #18181b; margin: 0; padding: 0;">
<div style="max-width: 480px; margin: 0 auto; padding: 32px 20px;">

<div style="margin-bottom: 24px;">
  <span style="display: inline-block; background: #ef4444; color: #fff; font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 4px; letter-spacing: 0.5px; text-transform: uppercase;">Review Request</span>
</div>

<p style="font-size: 14px; color: #a1a1aa; margin: 0 0 20px;">
  <strong style="color: #fafafa;">${user.username || "Unknown"}</strong> is disputing the adult flag on their upload.
</p>

<div style="background: #27272a; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
  <p style="margin: 0 0 8px; font-size: 13px; color: #71717a;">File</p>
  <p style="margin: 0 0 12px; font-size: 15px; color: #fafafa; font-weight: 500;">${fileTitle}</p>

  <p style="margin: 0 0 8px; font-size: 13px; color: #71717a;">Reason given</p>
  <p style="margin: 0 0 12px; font-size: 14px; color: #d4d4d8;">${sanitizedReason || "None"}</p>

  <p style="margin: 0 0 4px; font-size: 13px; color: #71717a;">Request</p>
  <p style="margin: 0; font-size: 14px; color: #d4d4d8;">${parsed.request_count} of 2</p>
</div>

<a href="${fileLink}" style="display: block; text-align: center; background: #fafafa; color: #18181b; font-size: 13px; font-weight: 600; padding: 10px 20px; border-radius: 6px; text-decoration: none; margin-bottom: 16px;">View content</a>

<div style="background: #27272a; border-radius: 6px; padding: 12px; margin-bottom: 20px;">
  <p style="margin: 0 0 6px; font-size: 12px; color: #71717a;">To respond, run in Supabase:</p>
  <code style="font-size: 12px; color: #a1a1aa; white-space: pre-wrap; word-break: break-all;">SELECT respond_adult_review('${parsed.request_id}'::uuid, true, 'message');</code>
</div>

<div style="border-top: 1px solid #27272a; padding-top: 16px; font-size: 11px; color: #52525b;">
  <p style="margin: 0;">user: ${user.email || "N/A"} &middot; file: <code style="font-size: 11px;">${file_id}</code></p>
  <p style="margin: 4px 0 0;">${new Date().toUTCString()}</p>
</div>

</div>
</body></html>`,
      });

      return data({
        ...parsed,
        email_sent: emailSent,
      }, { status: 200 });
    }

    return data({ success: false, error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Adult review API error:", error);
    return data({ success: false, error: "Internal server error" }, { status: 500 });
  }
};
