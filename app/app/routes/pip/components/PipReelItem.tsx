import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Maximize2 } from 'lucide-react';
import { cn, getVideoSrc } from '~/lib/utils';
import { formatNumber } from '~/lib/utils/formatNumber';
import { formatTimeAgo } from '~/lib/formatTimeAgo';
import { useWatchTracking } from '~/lib/hooks/useWatchTracking';
import { Button } from '~/components/ui/button';
import { DynamicHLSPlayerWithQueue } from '~/routes/Dynamic/components/DynamicHLSPlayerWithQueue';
import { PlayQueueProvider } from '~/routes/Dynamic/components/PlayQueueContext';
import Actions from '~/routes/Home/components/VideoCard/Actions';
import { useFileContext } from '~/lib/Context/Context';
import type { FileType } from '~/lib/types';
import { fileToFeedItem, type VerticalFeedItemData } from '~/components/vertical-feed';
import OwnerProfile from '~/components/OwnerProfile/OwnerProfile';
import {
  requestNavigateFromPipToMain,
  requestPipClosingHandshake,
} from '../pipEnv';
import { PIP_REEL_HLS_HIDE_CONTROLS } from './pipPlayerChrome';

/** Same as reel feed / `/api/pip-feed` `userActions` (see `VerticalFeed`). */
export type PipReelUserActions = {
  likedFileIds: string[];
  dislikedFileIds: string[];
};

export interface PipReelItemProps {
  file: FileType;
  isActive: boolean;
  showChrome?: boolean;
  userActions?: PipReelUserActions;
}

function isVideoLikeFile(f: FileType): boolean {
  const t = (f.file_type ?? '').toLowerCase();
  const ep = f.endpoint ?? '';
  return (
    t.startsWith('video/') ||
    t === 'application/vnd.apple.mpegurl' ||
    ep.includes('.m3u8')
  );
}

export function PipReelItem({
  file,
  isActive,
  showChrome = true,
  userActions,
}: PipReelItemProps) {
  const { userId } = useFileContext();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  /** Drives `useWatchTracking` when the HLS `<video>` mounts (ref alone doesn’t re-render). */
  const [trackedVideoEl, setTrackedVideoEl] = useState<HTMLVideoElement | null>(null);

  const isHLS =
    file.file_type === 'application/vnd.apple.mpegurl' ||
    Boolean(file.endpoint?.includes('.m3u8'));
  const isVideo =
    isHLS || Boolean(file.file_type?.toLowerCase().includes('video'));

  const [views, setViews] = useState(
    () => Number(file.views ?? file.view_count ?? 0),
  );
  const [hasIncrementedView, setHasIncrementedView] = useState(false);
  const viewIncrementSentRef = useRef(false);
  const viewIncrementTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const item: VerticalFeedItemData = {
    ...fileToFeedItem(file),
    file,
  };

  const fileIdStr = String(file.id);
  const likedFromActions = userActions
    ? new Set(userActions.likedFileIds).has(fileIdStr)
    : false;
  const dislikedFromActions = userActions
    ? new Set(userActions.dislikedFileIds).has(fileIdStr)
    : false;

  const [likeCount, setLikeCount] = useState(item.likeCount ?? 0);
  const [dislikeCount, setDislikeCount] = useState(item.dislikeCount ?? 0);
  const [liked, setLiked] = useState(
    likedFromActions || (item.liked ?? false),
  );
  const [disliked, setDisliked] = useState(
    dislikedFromActions || (item.disliked ?? false),
  );

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

  /** Reset when Swiper reuses a slide for a different `file` (virtual). */
  useEffect(() => {
    const id = String(file.id);
    if (userActions) {
      setLiked(new Set(userActions.likedFileIds).has(id));
      setDisliked(new Set(userActions.dislikedFileIds).has(id));
    } else {
      setLiked(item.liked ?? false);
      setDisliked(item.disliked ?? false);
    }
    setLikeCount(Number(file.like_count) || 0);
    setDislikeCount(Number(file.dislike_count) || 0);
    setViews(Number(file.views ?? file.view_count ?? 0));
    setHasIncrementedView(false);
    viewIncrementSentRef.current = false;
    setTrackedVideoEl(null);
    if (viewIncrementTimerRef.current) {
      clearTimeout(viewIncrementTimerRef.current);
      viewIncrementTimerRef.current = null;
    }
  }, [file.id, userActions, item.liked, item.disliked]);

  useWatchTracking({
    fileId: String(file.id),
    userId,
    isVideo,
    videoElement: trackedVideoEl,
    source: 'pip_reel',
  });

  useEffect(() => {
    if (!file.id || !file.unique_id) return;
    fetch('/api/views/watch-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: file.id, uniqueId: file.unique_id }),
      credentials: 'include',
    }).catch(() => {});
  }, [file.id, file.unique_id]);

  const requiredViewSeconds = useMemo(() => {
    if (isHLS && file.duration != null && Number(file.duration) > 0) {
      const d = Number(file.duration);
      const half = Math.ceil(d * 0.5);
      return Math.min(30, Math.max(3, half));
    }
    return 30;
  }, [isHLS, file.duration]);

  const runViewIncrement = useCallback(() => {
    if (
      !file.id ||
      !file.unique_id ||
      hasIncrementedView ||
      viewIncrementSentRef.current
    )
      return;
    viewIncrementSentRef.current = true;
    const payload = {
      fileId: file.id,
      uniqueId: file.unique_id,
      minimumWatchSeconds: requiredViewSeconds,
      ...(file.duration != null && { durationSeconds: Number(file.duration) }),
    };
    fetch('/api/views/increment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((result) => {
        if (result?.success && result.counted !== false) {
          setViews((v) => result.views ?? result.view_count ?? v + 1);
          setHasIncrementedView(true);
        }
      })
      .catch(() => {});
  }, [
    file.id,
    file.unique_id,
    file.duration,
    hasIncrementedView,
    requiredViewSeconds,
  ]);

  const onVideoPlayForView = useCallback(() => {
    if (
      hasIncrementedView ||
      viewIncrementSentRef.current ||
      viewIncrementTimerRef.current
    )
      return;
    viewIncrementTimerRef.current = setTimeout(() => {
      viewIncrementTimerRef.current = null;
      runViewIncrement();
    }, requiredViewSeconds * 1000);
  }, [hasIncrementedView, runViewIncrement, requiredViewSeconds]);

  useEffect(
    () => () => {
      if (viewIncrementTimerRef.current) {
        clearTimeout(viewIncrementTimerRef.current);
        viewIncrementTimerRef.current = null;
      }
    },
    [],
  );

  const handlePlayerVideoRef = useCallback((el: HTMLVideoElement | null) => {
    setTrackedVideoEl(el);
  }, []);

  const handleVideoPlay = useCallback(() => {
    onVideoPlayForView();
  }, [onVideoPlayForView]);

  const fileId = item.fileId ?? item.id;
  const uniqueId = item.unique_id ?? item.id;
  const isOwner = Boolean(userId && item.ownerId && userId === item.ownerId);

  const videoSrc = isVideoLikeFile(file)
    ? getVideoSrc(file.endpoint ?? '', file.file_type)
    : undefined;

  const getShareTimestamp = useCallback(
    () => videoRef.current?.currentTime ?? 0,
    []
  );

  /**
   * "Open in main" — leaves the PiP iframe and navigates the main window to `/{unique_id}`.
   * Sends the close handshake with our current timestamp so the shell can resume at the same
   * spot in the full Dynamic player. Falls back to in-place navigation when this page isn't
   * framed (e.g. someone opened `/pip/:id` directly in a tab).
   */
  const handleOpenInMain = useCallback(() => {
    const uid = file.unique_id;
    if (!uid) return;
    const t = videoRef.current?.currentTime ?? 0;
    const href = `/${uid}`;

    requestPipClosingHandshake(t, uid);
    requestNavigateFromPipToMain(href);

    // If we're not inside a PiP iframe and have no opener, nothing heard those messages — go local.
    if (
      typeof window !== 'undefined' &&
      window.parent === window &&
      !window.opener
    ) {
      navigate(href);
    }
  }, [file.unique_id, navigate]);

  return (
    <div
      className={cn(
        'relative flex h-full min-h-0 w-full shrink-0 flex-col bg-background reel_p',
        isActive && 'ring-1 ring-border'
      )}
      data-pip-reel-item-id={item.id}
    >
      {/*
        Video well. Actions float over the video (bottom-right) TikTok-style — no separate rail.
        Swiper steals pointer events on slides, so the Actions wrapper opts out via `swiper-no-swiping`
        and sits in its own z-layer so Radix dropdowns inside `Actions` still work.
      */}
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-black">
        {videoSrc ? (
          <PlayQueueProvider
            currentUniqueId={file.unique_id}
            seriesUpNextVideos={[]}
            suggestedVideos={[]}
            viewerCanCustomizeQueue={Boolean(userId)}
          >
            <DynamicHLSPlayerWithQueue
              src={videoSrc}
              videoRef={videoRef}
              className="h-full w-full"
              autoPlay
              muted={false}
              unlockPipReelAudio
              loop
              playsInline
              imageID={file.unique_id}
              file={file}
              showFeedPlayerControls
              hideControls={PIP_REEL_HLS_HIDE_CONTROLS}
              isReel
              onPlay={handleVideoPlay}
              onVideoRef={handlePlayerVideoRef}
            />
          </PlayQueueProvider>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
            <span className="text-sm font-medium">Preview unavailable</span>
          </div>
        )}

        {/*
          Thin right-edge fade behind the floating buttons so glyphs stay readable on bright footage.
          Stops above the seek bar (doesn't cover the scrub chrome) and doesn't reach the center.
        */}
        <div
          aria-hidden
          className="pointer-events-none absolute right-0 top-0 w-20 bg-gradient-to-l from-black/35 to-transparent"
          style={{ bottom: 'calc(3.25rem + env(safe-area-inset-bottom, 0px))' }}
        />

        {/*
          Floating TikTok-style action rail — overlays the video, anchored bottom-right.
          Lifted above the reel seek bar + bottom button row (~3.5rem of chrome) so the buttons
          never sit on top of scrub / play controls.
        */}
        <div
          className={cn(
            'swiper-no-swiping pointer-events-auto absolute right-0 z-20',
            'bottom-[calc(3.75rem+env(safe-area-inset-bottom,0px))]',
            'flex flex-col items-end',
            'px-2 pt-2'
          )}
        >
          <Actions
            layout="tiktok"
            fileId={fileId}
            uniqueId={uniqueId}
            likeCount={likeCount}
            dislikeCount={dislikeCount}
            commentCount={
              Number(file.comment_count ?? item.commentCount ?? 0) || 0
            }
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
      </div>

      {/* Bottom: title / caption — below the player so nothing covers the picture. */}
      {showChrome && (
        <div className="shrink-0 border-t border-border bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {/* Profile row + "open in main" — aligned so the button sits next to the owner avatar. */}
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              {file.owner?.username ? (
                <OwnerProfile
                  owner={file.owner}
                  size="sm"
                  showUsername
                  className="text-foreground [&_span]:text-foreground hover:text-foreground [&_span]:hover:text-foreground"
                />
              ) : (
                <p className="truncate text-sm font-semibold text-foreground">
                  @{item.username || '…'}
                </p>
              )}
            </div>

            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={handleOpenInMain}
              disabled={!file.unique_id}
              className="h-8 shrink-0 gap-1.5 px-3 text-xs"
              aria-label="Open this video in the main player"
              title="Open in main player"
            >
              <Maximize2 className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">Open</span>
            </Button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground sm:text-xs">
            <span className="font-medium tabular-nums text-foreground">
              {formatNumber(views)} views
            </span>
            {file.created_at ? (
              <>
                <span className="text-muted-foreground/50" aria-hidden>
                  ·
                </span>
                <span>{formatTimeAgo(file.created_at)}</span>
              </>
            ) : null}
          </div>

          {item.title ? (
            <p className="mt-1.5 truncate text-sm font-semibold leading-tight text-foreground">
              {item.title}
            </p>
          ) : null}

          {item.caption ? (
            <p className="mt-1 line-clamp-2 text-sm leading-snug text-muted-foreground">
              {item.caption}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
