import { useState } from "react";
import { Link } from "react-router";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { useAuthHrefs } from "~/lib/loginRedirect";
import { LogIn, UserPlus, Lock } from "lucide-react";

/**
 * Inline banner shown at the bottom of a feed when the user is not signed in.
 * Replaces the infinite-scroll sentinel so un-authed visitors see a CTA
 * instead of endlessly loading more content.
 */
export function SignInToSeeMore() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <div className="my-8 flex flex-col items-center gap-3 rounded-xl border border-border/60 bg-muted/30 px-6 py-8 text-center backdrop-blur-sm">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Lock className="h-5 w-5" />
        </div>
        <p className="text-base font-semibold text-foreground">
          Sign in to see more
        </p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Create a free account to unlock unlimited browsing, uploads,
          playlists, and more.
        </p>
        <Button
          onClick={() => setDialogOpen(true)}
          className="mt-1 gap-2"
          size="lg"
        >
          <LogIn className="h-4 w-4" />
          Continue
        </Button>
      </div>

      <SignInDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}

/**
 * Reusable sign-in / create-account dialog.
 * Used by the feed wall and the upload button gate.
 */
export function SignInDialog({
  open,
  onOpenChange,
  title = "Sign in to continue",
  description = "Create a free account or sign in to enjoy full access  uploads, playlists, comments, and more.",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title?: string;
  description?: string;
}) {
  const { loginHref, signupHref } = useAuthHrefs();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex w-[calc(100vw-1.5rem)] max-w-md flex-col gap-5 overflow-hidden">
        <DialogHeader className="items-center text-center gap-3">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-primary">
            <LogIn className="h-7 w-7" strokeWidth={1.75} />
          </div>
          <DialogTitle className="text-lg">{title}</DialogTitle>
          <DialogDescription className="sr-only">{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button asChild className="w-full gap-2" size="lg">
            <Link to={loginHref} onClick={() => onOpenChange(false)}>
              <LogIn className="h-4 w-4" />
              Sign In
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className="w-full gap-2"
            size="lg"
          >
            <Link to={signupHref} onClick={() => onOpenChange(false)}>
              <UserPlus className="h-4 w-4" />
              Create Account
            </Link>
          </Button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="mt-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Maybe later
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
