import { LogIn, Lock } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Button } from '~/components/ui/button';

export const GUEST_PLAYBACK_BENEFITS = [
  'Full quality playback when your connection can handle it',
  'Player settings for speed and more, with what you pick remembered next time',
  'Theater mode for a wider, more cinematic view',
  'Mini player so the video stays with you while you look around the site',
  'Autoplay and an easy jump to what plays next when a video finishes',
] as const;

type GuestPlaybackSignInDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
};

export function GuestPlaybackSignInDialog({
  open,
  onOpenChange,
  title = 'Sign in for the full player',
  description = 'Sign in and you get the full player: better quality, more control, and a few extras that make watching feel smoother.',
}: GuestPlaybackSignInDialogProps) {
  const location = useLocation();
  const loginHref = `/auth/login?redirect=${encodeURIComponent(
    location.pathname + location.search,
  )}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          {GUEST_PLAYBACK_BENEFITS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
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
