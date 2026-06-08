import { Link } from "react-router";
import { LogIn, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { useAuthHrefs } from "~/lib/loginRedirect";

type Props = {
  visible: boolean;
  secondsRemaining: number;
  onDismiss: () => void;
};

export default function GuestPreviewNudge({
  visible,
  secondsRemaining,
  onDismiss,
}: Props) {
  const { loginHref } = useAuthHrefs();
  if (!visible) return null;

  const s = Math.max(0, Math.ceil(secondsRemaining));

  return (
    <div
      className="pointer-events-auto absolute bottom-[4.5rem] left-3 right-3 z-[55] flex flex-col gap-2 rounded-lg border border-border/60 bg-black/85 px-3 py-2.5 text-sm text-foreground shadow-lg backdrop-blur-sm sm:bottom-[5rem] sm:left-4 sm:right-4 sm:flex-row sm:items-center sm:justify-between sm:px-4"
      role="status"
    >
      <p className="text-left text-muted-foreground">
        Preview ends in about{" "}
        <span className="font-medium tabular-nums text-foreground">{s}s</span>.{" "}
        <span className="text-foreground">Sign in</span> to watch the full video.
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button asChild size="sm" className="gap-1.5">
          <Link to={loginHref}>
            <LogIn className="h-3.5 w-3.5" />
            Sign in
          </Link>
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-muted-foreground"
          onClick={onDismiss}
          aria-label="Dismiss preview notice"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
