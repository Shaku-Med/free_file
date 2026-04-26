import { useCallback, useRef, useState } from 'react';
import { Music2 } from 'lucide-react';
import { cn, getVideoSrc } from '~/lib/utils';
import ParseFilenameInsert from '~/lib/utils/ShowFileName';
import { FormattedText } from '~/components/FormattedText';
// Same `~/components/components/hlsplayer` as Dynamic (queue wrapper adds suggested/next props only).
import HLSPlayer from '~/components/components/hlsplayer';
import Actions from '~/routes/Home/components/VideoCard/Actions';
import { useFileContext } from '~/lib/Context/Context';
import { type FileType, fileWatchPath } from '~/lib/types';
import type { VerticalFeedItemData } from './types';

interface VerticalFeedItemProps {
  item: VerticalFeedItemData;
  isActive: boolean;
  showChrome?: boolean;
}

function isVideoLikeFile(file: FileType | undefined): boolean {
  if (!file) return false;
  const t = (file.file_type ?? '').toLowerCase();
  const ep = file.endpoint ?? '';
  return (
    t.startsWith('video/') ||
    t === 'application/vnd.apple.mpegurl' ||
    ep.includes('.m3u8')
  );
}

export function VerticalFeedItem({
  item,
  isActive,
  showChrome = true,
}: VerticalFeedItemProps) {
  const { userId } = useFileContext();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const file = item.file;

  const [likeCount, setLikeCount] = useState(item.likeCount ?? 0);
  const [dislikeCount, setDislikeCount] = useState(item.dislikeCount ?? 0);
  const [liked, setLiked] = useState(item.liked ?? false);
  const [disliked, setDisliked] = useState(item.disliked ?? false);
  const [muted] = useState(true);

  const handleUpdate = (u: {
    liked: boolean;
    disliked: boolean;
    like_count: number;
    dislike_count: number;
  }) => {
    setLiked(u.liked);
    setDisliked(u.disliked);
    setLikeCount(u.like_count);
    setDislikeCount(u.dislike_count);
  };

  const fileId = item.fileId ?? item.id;
  const uniqueId = item.unique_id ?? item.id;
  const sharePagePath = file ? fileWatchPath(file) : `/${uniqueId}`;
  const isOwner = Boolean(userId && item.ownerId && userId === item.ownerId);

  const videoSrc =
    file && isVideoLikeFile(file)
      ? getVideoSrc(file.endpoint ?? '', file.file_type)
      : undefined;

  const getShareTimestamp = useCallback(
    () => videoRef.current?.currentTime ?? 0,
    []
  );

  // NOTE: no manual play/pause here. `HLSPlayer` (via `isReel` + its internal IntersectionObserver)
  // is the single source of truth for which reel is playing — duplicating the gate here raced with
  // it during Swiper virtual transitions and caused multiple slides to play simultaneously.

  return (
    <div
      className={cn(
        'relative flex h-[100dvh] min-h-[100dvh] w-full shrink-0 flex-col bg-black',
        isActive && 'ring-1 ring-white/10'
      )}
      data-feed-item-id={item.id}
    >
      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
        <div className="absolute inset-0 z-[1] overflow-hidden">
          {videoSrc && file ? (
            <HLSPlayer
              src={videoSrc}
              videoRef={videoRef}
              className="h-full w-full"
              autoPlay={true}
              reelSwiperActive={isActive}
              muted={muted}
              loop={true}
              playsInline
              imageID={file.unique_id}
              file={file}
              isReel
              showFeedPlayerControls={false}
              onVideoRef={(el) => {
                videoRef.current = el;
              }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-zinc-950 text-zinc-500">
              <span className="text-sm font-medium">
                {file ? 'Preview unavailable' : 'Loading…'}
              </span>
            </div>
          )}
        </div>

        <div className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-b from-black/50 via-transparent to-black/70" />

        {showChrome && (
          <>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[3] bg-gradient-to-t from-black/85 via-black/25 to-transparent pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-28">
              <div className="pointer-events-auto max-w-[calc(100%-5rem)] px-4 pb-6">
                <p className="text-sm font-semibold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                  @{item.username}
                </p>
                {item.caption?.trim() ? (
                  <p className="mt-1 line-clamp-3 text-sm leading-snug text-white/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)]">
                    <FormattedText
                      text={item.caption.trim()}
                      className="text-white/95 [&_a]:text-sky-300 [&_a]:hover:text-sky-200"
                    />
                  </p>
                ) : file?.file_title?.trim() || file?.filename ? (
                  <p className="mt-1 line-clamp-3 text-sm font-semibold leading-snug text-white/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)]">
                    <ParseFilenameInsert
                      filename={file.file_title?.trim() || file.filename || ''}
                      className="text-white/95 [&_a]:text-sky-300 [&_a]:hover:text-sky-200"
                    />
                  </p>
                ) : null}
                <div className="mt-3 flex items-center gap-2 text-xs text-white/75">
                  <Music2 className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
                  <span className="truncate">
                    Original sound —{' '}
                    <ParseFilenameInsert
                      filename={
                        file?.file_title?.trim() || file?.filename || item.title || ''
                      }
                      className="text-white/75 [&_a]:text-sky-300 [&_a]:hover:text-sky-200"
                    />
                  </span>
                </div>
              </div>
            </div>

            <div className="pointer-events-auto absolute bottom-[calc(1.25rem+env(safe-area-inset-bottom,0px))] right-3 z-[4] flex flex-col items-end gap-1">
              <Actions
                layout="tiktok"
                fileId={fileId}
                uniqueId={uniqueId}
                sharePagePath={sharePagePath}
                likeCount={likeCount}
                dislikeCount={dislikeCount}
                commentCount={item.commentCount ?? 0}
                liked={liked}
                disliked={disliked}
                isOwner={isOwner}
                currentUserId={userId ?? null}
                fileCreatedAt={item.createdAt ?? null}
                fileOwnerId={item.ownerId}
                getShareTimestamp={getShareTimestamp}
                onUpdate={handleUpdate}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
