import { CircleHelp } from 'lucide-react';
import { useState } from 'react';
import { mobileOverlayIcon, mobileOverlaySmallCircleBtn } from './mobileControlMetrics';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';
import { GuestPlaybackSignInDialog } from './GuestPlaybackSignInDialog';

export default function GuestPlaybackBenefitsDialog({
  variant = 'controlPill',
}: {
  variant?: 'mobileOverlay' | 'controlPill';
}) {
  const [open, setOpen] = useState(false);
  const btnClass =
    variant === 'mobileOverlay'
      ? mobileOverlaySmallCircleBtn
      : 'rounded-lg p-2 text-white transition-colors hover:bg-white/10';

  return (
    <>
      <Tooltip delayDuration={350}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
            }}
            className={btnClass}
            aria-label="What you get when you sign in"
          >
            <CircleHelp className={variant === 'mobileOverlay' ? mobileOverlayIcon : 'h-5 w-5'} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">Sign in for the full player</TooltipContent>
      </Tooltip>
      <GuestPlaybackSignInDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
