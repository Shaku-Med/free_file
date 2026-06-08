import { Link } from "react-router";
import { LogIn } from "lucide-react";
import { Button } from "~/components/ui/button";
import { useAuthHrefs } from "~/lib/loginRedirect";

type Props = {
  open: boolean;
  limitSeconds: number;
  onDismiss: () => void;
};

function formatClock(sec: number) {
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${String(r).padStart(2, "0")}` : `${r}s`;
}

export default function GuestPreviewWall({ open, limitSeconds, onDismiss }: Props) {
  const { loginHref } = useAuthHrefs();
  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-[100] flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guest-preview-title"
    >
      <div className="max-w-sm rounded-xl border border-border/60 bg-card p-6 text-center shadow-lg">
        <h2 id="guest-preview-title" className="text-lg font-semibold text-foreground">
          Preview ended
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Signed-out viewers can watch up to {formatClock(limitSeconds)} of this video. Sign in for the
          full video.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button asChild className="gap-2">
            <Link to={loginHref}>
              <LogIn className="h-4 w-4" />
              Sign in
            </Link>
          </Button>
          <Button type="button" variant="outline" onClick={onDismiss}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
