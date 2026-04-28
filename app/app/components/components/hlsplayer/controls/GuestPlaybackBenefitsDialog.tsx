import { CircleHelp, LogIn } from 'lucide-react';
import { Link } from 'react-router';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog';
import { Button } from '~/components/ui/button';

const benefits = [
  'Full quality playback when your connection can handle it',
  'Player settings for speed and more, with what you pick remembered next time',
  'Theater mode for a wider, more cinematic view',
  'Mini player so the video stays with you while you look around the site',
  'Autoplay and an easy jump to what plays next when a video finishes',
] as const;

export default function GuestPlaybackBenefitsDialog({
  variant = 'controlPill',
}: {
  variant?: 'mobileOverlay' | 'controlPill';
}) {
  const btnClass =
    variant === 'mobileOverlay'
      ? 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/50 text-white shadow-sm backdrop-blur-sm active:scale-95 transition-transform'
      : 'rounded-lg p-2 text-white transition-colors hover:bg-white/10';

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
          }}
          className={btnClass}
          aria-label="What you get when you sign in"
        >
          <CircleHelp className="h-5 w-5" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-xl sm:max-w-xl  w-full">
        <DialogHeader>
          <DialogTitle>Sign in for the full player</DialogTitle>
          <DialogDescription>
            Sign in and you get the full player: better quality, more control, and a few extras
            that make watching feel smoother.
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          {benefits.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <DialogFooter className="sm:justify-start">
          <Button asChild className="gap-2">
            <Link to="/auth/login">
              <LogIn className="h-4 w-4" />
              Sign in
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
