import { useState } from 'react';
import ImageLoad from '~/routes/Home/components/ImageLoad/ImageLoad';
import { getRandomThumbnail, arrangeDateForThumbnail } from '~/lib/utils';
import { usePlayerContext } from '../PlayerContext';

interface PosterBackgroundProps {
  onImageLoaded?: (src: string, colors: string[]) => void;
}

export default function PosterBackground({ onImageLoaded }: PosterBackgroundProps) {
  const { file, imageID, setAmbientColors } = usePlayerContext();
  const [retryCount, setRetryCount] = useState(0);
  const [hasError, setHasError] = useState(false);

  if (!file) return null;

  const link = (() => {
    const thumb = getRandomThumbnail(file.thumbnails);
    if (thumb) return `/api/load/image/${thumb}`;
    return `/api/load/image/${arrangeDateForThumbnail(file.created_at, retryCount)}/${file.unique_id}/thumbnail_${file.filename.split('.mp4.m3u8')[0]}.jpg`;
  })();

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <div className="w-full h-full blur-2xl scale-110">
        {!hasError ? (
          <ImageLoad
            callBack={e => {
              if (e) {
                const colors = e.colors || [];
                setAmbientColors(colors);
                onImageLoaded?.(e.src, colors);
              }
            }}
            hasAdultTag={false}
            link={link}
            retry={() => {
              if (retryCount < 1) setRetryCount(retryCount + 1);
              else setHasError(true);
            }}
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
