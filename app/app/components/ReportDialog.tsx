import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { signedFetch } from "~/lib/Security/requestSigning.client";
import { toast } from "~/components/ui/sonner";

export type ReportTargetType = "file" | "comment" | "user";

export interface ReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetType: ReportTargetType;
  targetId: string;
  /** Optional short label for the thing being reported (e.g. video title). */
  targetLabel?: string;
}

interface ReasonOption {
  value:
    | "spam"
    | "nsfw_unmarked"
    | "harassment"
    | "hate"
    | "violence"
    | "self_harm"
    | "child_safety"
    | "copyright"
    | "impersonation"
    | "scam"
    | "other";
  label: string;
}

const REASONS: ReasonOption[] = [
  { value: "spam", label: "Spam" },
  { value: "nsfw_unmarked", label: "Adult content not marked" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "hate", label: "Hate speech" },
  { value: "violence", label: "Violence or threats" },
  { value: "self_harm", label: "Self-harm" },
  { value: "child_safety", label: "Child safety" },
  { value: "copyright", label: "Copyright" },
  { value: "impersonation", label: "Impersonation" },
  { value: "scam", label: "Scam or fraud" },
  { value: "other", label: "Other" },
];

export function ReportDialog({
  open,
  onOpenChange,
  targetType,
  targetId,
  targetLabel,
}: ReportDialogProps) {
  const [reason, setReason] = useState<ReasonOption["value"] | null>(null);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setReason(null);
      setDetails("");
      setSubmitting(false);
    }
  }, [open]);

  async function submit() {
    if (!reason || submitting) return;
    setSubmitting(true);
    try {
      const res = await signedFetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_type: targetType,
          target_id: targetId,
          reason,
          details: details.trim() || null,
        }),
      });
      if (res.status === 429) {
        toast.error("Too many reports today. Try again later.");
        return;
      }
      if (res.status === 403) {
        toast.error("You can't report your own content.");
        return;
      }
      if (res.status === 404) {
        toast.error("That content is no longer available.");
        return;
      }
      if (!res.ok) {
        toast.error("Couldn't send your report. Try again.");
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { already?: boolean };
      toast.success(body.already ? "Already reported." : "Reported. Thanks.");
      onOpenChange(false);
    } catch {
      toast.error("Couldn't send your report. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Report{targetLabel ? `: ${targetLabel.slice(0, 32)}` : ""}</DialogTitle>
          <DialogDescription className="sr-only">Pick a reason</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {REASONS.map((r) => {
              const selected = r.value === reason;
              return (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setReason(r.value)}
                  className={
                    selected
                      ? "rounded-lg border border-primary bg-primary/10 px-3 py-2 text-left text-sm font-medium text-foreground"
                      : "rounded-lg border border-border bg-background px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  }
                  aria-pressed={selected}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
          <Textarea
            value={details}
            onChange={(e) => setDetails(e.target.value.slice(0, 500))}
            placeholder="Anything else (optional)"
            rows={2}
            className="resize-none text-sm"
          />
          <p className="text-right text-[10px] tabular-nums text-muted-foreground">
            {details.length}/500
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={!reason || submitting}>
            {submitting ? "Sending…" : "Submit"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ReportDialog;
