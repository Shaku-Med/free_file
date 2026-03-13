import { useState, useCallback, useMemo, useRef } from 'react';
import ImageLoad from '~/routes/Home/components/ImageLoad/ImageLoad';
import { getRandomThumbnail, arrangeDateForThumbnail } from '~/lib/utils';
import { usePlayerContext } from '../PlayerContext';

interface PosterBackgroundProps {
  onImageLoaded?: (src: string, colors: string[], mediaSessionUrl?: string) => void;
}

export default function PosterBackground({ onImageLoaded }: PosterBackgroundProps) {
  const { file, imageID, setAmbientColors } = usePlayerContext();
  const [retryCount, setRetryCount] = useState(0);
  const [hasError, setHasError] = useState(false);

  const onImageLoadedRef = useRef(onImageLoaded);
  onImageLoadedRef.current = onImageLoaded;

  const link = useMemo(() => {
    if (!file) return '';
    const thumb = getRandomThumbnail(file.thumbnails);
    if (thumb) return `/api/load/image/${thumb}`;
    return `/api/load/image/${arrangeDateForThumbnail(file.created_at, retryCount)}/${file.unique_id}/thumbnail_${file.filename.split('.mp4.m3u8')[0]}.jpg`;
  }, [file?.thumbnails, file?.created_at, file?.unique_id, file?.filename, retryCount]);

  const handleRetry = useCallback(() => {
    if (retryCount < 1) setRetryCount(prev => prev + 1);
    else setHasError(true);
  }, [retryCount]);

  const handleCallBack = useCallback((e: { src: string; colors: string[]; mediaSessionUrl?: string }) => {
    if (e) {
      const colors = e.colors || [];
      setAmbientColors(colors);
      onImageLoadedRef.current?.(e.src, colors, e.mediaSessionUrl);
    }
  }, [setAmbientColors]);

  if (!file) return null;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <div className="w-full h-full blur-2xl scale-110">
        {!hasError ? (
          <ImageLoad
            callBack={handleCallBack}
            getMediaSessionURL={true}
            hasAdultTag={Boolean(file?.is_adult)}
            link={link}
            retry={handleRetry}
            className="w-full h-full object-cover"
            imageID={imageID}
            index={0}
          />
        ) : (
          <div className="w-full h-full bg-neutral-900" />
        )}
      </div>
      <div className="absolute inset-0 bg-black/50" />
    </div>
  );
}
