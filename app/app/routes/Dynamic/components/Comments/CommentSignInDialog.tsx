import { Link, useLocation } from "react-router";
import { LogIn, Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";

type CommentSignInDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
};

export function CommentSignInDialog({
  open,
  onOpenChange,
  title = "Sign in to continue",
  description = "Create an account or sign in to use this comments feature.",
}: CommentSignInDialogProps) {
  const location = useLocation();
  const loginHref = `/auth/login?redirect=${encodeURIComponent(
    location.pathname + location.search,
  )}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-start">
          <Button asChild className="gap-2">
            <Link to={loginHref} onClick={() => onOpenChange(false)}>
              <LogIn className="h-4 w-4" />
              Sign in
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
