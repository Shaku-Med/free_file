import { useEffect } from 'react';
import { cn, getThumbnailUrl } from '~/lib/utils';
import { BASE_URL } from '~/lib/URLS';
import { mobileOverlayIcon, mobileOverlaySquareBtn } from '../mobileControlMetrics';
import { usePlayerContext } from '../../PlayerContext';
import { useRemotePlayback } from '../../hooks/useRemotePlayback';
import { useGoogleCast } from '../../hooks/useGoogleCast';
import AirPlayIcon from './CastIcon';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';

export default function CastButton({
  controlPill = false,
  mobileOverlay = false,
}: {
  controlPill?: boolean;
  mobileOverlay?: boolean;
}) {
  const { videoRef, file, state } = usePlayerContext();
  const remote = useRemotePlayback(videoRef);
  const gcast = useGoogleCast();

  // Google Cast (Chrome / Android desktop) when devices are around, else
  // AirPlay / Remote Playback (Safari, iOS).
  const isAvailable = gcast.castAvailable || remote.isAvailable;
  const isCasting = gcast.isCasting || remote.isCasting;

  // Pause local playback while a Google Cast session is live so the TV and the
  // browser don't play the same audio at once.
  useEffect(() => {
    if (gcast.isCasting && videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
    }
  }, [gcast.isCasting, videoRef]);

  if (!isAvailable) return null;

  const runPrompt = () => {
    if (gcast.castAvailable && file?.unique_id) {
      if (gcast.isCasting) {
        gcast.stopCast();
        return;
      }
      void gcast.startCast({
        fileId: file.unique_id,
        title: file.file_title || file.filename || undefined,
        poster: getThumbnailUrl(file, {
          baseUrl: BASE_URL,
          queryString: '?quality=60&is_metadata=true',
        }),
        currentTime: state?.currentTime,
      });
      return;
    }
    void remote.prompt();
  };

  return (
    <Tooltip delayDuration={350}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            if (mobileOverlay) e.stopPropagation();
            runPrompt();
          }}
          className={cn(
            'relative transition-colors',
            mobileOverlay && mobileOverlaySquareBtn,
            !mobileOverlay &&
              cn(
                controlPill ? 'rounded-full p-2' : 'rounded-md p-1.5',
                'text-white',
                isCasting ? 'bg-white/20 hover:bg-white/25' : 'hover:bg-white/10'
              ),
            mobileOverlay && isCasting && 'bg-white/25 text-white'
          )}
          aria-label={isCasting ? 'Connected to device' : 'Cast to device'}
        >
          <AirPlayIcon className={mobileOverlay ? mobileOverlayIcon : 'w-5 h-5'} />
          {isCasting && (
            <span className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-white" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {isCasting ? 'Connected – tap to disconnect' : 'Cast to TV or other device'}
      </TooltipContent>
    </Tooltip>
  );
}
