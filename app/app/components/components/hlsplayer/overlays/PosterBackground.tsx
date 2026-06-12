import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import ImageLoad from '~/routes/Home/components/ImageLoad/ImageLoad';
import { getThumbnailUrl } from '~/lib/utils';
import { usePlayerContext } from '../PlayerContext';

interface PosterBackgroundProps {
  onImageLoaded?: (src: string, colors: string[], mediaSessionUrl?: string) => void;
  /** When false, thumbnail is still loaded for media session but not shown. */
  showBackdrop?: boolean;
}

export default function PosterBackground({ onImageLoaded, showBackdrop = true }: PosterBackgroundProps) {
  const { file, imageID } = usePlayerContext();
  const [retryCount, setRetryCount] = useState(0);
  const [hasError, setHasError] = useState(false);

  const onImageLoadedRef = useRef(onImageLoaded);
  onImageLoadedRef.current = onImageLoaded;

  const fileIdentity = file?.unique_id;
  useEffect(() => {
    setRetryCount(0);
    setHasError(false);
  }, [fileIdentity]);

  const link = useMemo(() => {
    if (!file) return '';
    return getThumbnailUrl(file, { retryAttempt: retryCount });
  }, [file?.default_thumbnail, file?.thumbnails, file?.file_type, file?.endpoint, file?.created_at, file?.unique_id, file?.filename, retryCount]);

  const handleRetry = useCallback(() => {
    if (retryCount < 1) setRetryCount(prev => prev + 1);
    else setHasError(true);
  }, [retryCount]);

  const linkRef = useRef(link);
  linkRef.current = link;

  const handleCallBack = useCallback((e: { src: string; colors: string[]; mediaSessionUrl?: string }) => {
    if (!e) return;
    const httpArtworkUrl = linkRef.current
      ? `${window.location.origin}${linkRef.current}`
      : e.mediaSessionUrl;
    onImageLoadedRef.current?.(e.src, e.colors || [], httpArtworkUrl);
  }, []);

  if (!file) return null;

  if (!showBackdrop) {
    return (
      <div className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0" aria-hidden>
        {!hasError ? (
          <ImageLoad
            key={fileIdentity}
            callBack={handleCallBack}
            getMediaSessionURL={true}
            hasAdultTag={Boolean(file?.is_adult)}
            link={link}
            retry={handleRetry}
            className="h-px w-px"
            imageID={imageID}
            index={0}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <div className="w-full h-full blur-2xl scale-110">
        {!hasError ? (
          <ImageLoad
            key={fileIdentity}
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
