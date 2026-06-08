import { Link } from "react-router";
import { Layers, LogIn, Lock } from "lucide-react";
import { Button } from "~/components/ui/button";
import { useAuthHrefs } from "~/lib/loginRedirect";

/**
 * Shown on the watch page when the media belongs to a series but the viewer is not signed in.
 */
export default function SeriesSignInGate() {
  const { loginHref } = useAuthHrefs();
  return (
    <div className="rounded-lg border border-border/60 bg-muted/25 p-4">
      <div className="flex gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Lock className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" aria-hidden />
            <p className="text-sm font-semibold text-foreground">Series</p>
          </div>
          <p className="text-sm text-muted-foreground">
            Sign in to view episodes, see where this video fits in the series, and jump between parts.
          </p>
          <Button asChild size="sm" className="gap-2">
            <Link to={loginHref}>
              <LogIn className="h-4 w-4" />
              Sign in
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
