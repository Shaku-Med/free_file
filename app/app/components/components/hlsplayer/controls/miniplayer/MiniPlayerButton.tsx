import { PictureInPicture2 } from 'lucide-react';
import { useCallback } from 'react';
import { usePlayerContext } from '../../PlayerContext';
import { useMiniPlayerContext } from '~/lib/Context/MiniPlayerContext';
import { getVideoSrc } from '~/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';

export default function MiniPlayerButton() {
  const { videoRef, src, imageID, file, isReel } = usePlayerContext();
  const { activateMiniPlayer, getNavigateBackTarget, sourceVideoRef } = useMiniPlayerContext();

  const handleClick = useCallback(() => {
    const video = videoRef.current;
    if (!video || !file) return;

    const backTarget = getNavigateBackTarget();

    // Store ref to the large video so the mini player can mute it once it starts playing
    sourceVideoRef.current = video;

    activateMiniPlayer(
      {
        src: src || getVideoSrc(file.endpoint ?? '', file.file_type),
        file,
        currentTime: video.currentTime,
        imageID: imageID || file.unique_id,
        wasPlaying: !video.paused,
        volume: video.volume,
        muted: video.muted,
        playbackRate: video.playbackRate,
      },
      { navigateTo: backTarget }
    );
  }, [videoRef, src, file, imageID, activateMiniPlayer, getNavigateBackTarget, sourceVideoRef]);

  if (isReel || !file) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleClick}
          className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-white"
          aria-label="Mini player"
        >
          <PictureInPicture2 className="w-5 h-5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">Mini player</TooltipContent>
    </Tooltip>
  );
}
