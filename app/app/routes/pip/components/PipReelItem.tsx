import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Maximize2 } from 'lucide-react';
import { cn, getThumbnailUrl, getVideoSrc, ParseFilename } from '~/lib/utils';
import ParseFilenameInsert from '~/lib/utils/ShowFileName';
import { FormattedText } from '~/components/FormattedText';
import { formatNumber } from '~/lib/utils/formatNumber';
import { formatTimeAgo } from '~/lib/formatTimeAgo';
import { useWatchTracking } from '~/lib/hooks/useWatchTracking';
import { Button } from '~/components/ui/button';
import { DynamicHLSPlayerWithQueue } from '~/routes/Dynamic/components/DynamicHLSPlayerWithQueue';
import { PlayQueueProvider } from '~/routes/Dynamic/components/PlayQueueContext';
import Actions from '~/routes/Home/components/VideoCard/Actions';
import { useFileContext } from '~/lib/Context/Context';
import { type FileType, fileWatchPath } from '~/lib/types';
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

export type PipReelItemVariant = 'pip' | 'page';

export interface PipReelItemProps {
  file: FileType;
  isActive: boolean;
  showChrome?: boolean;
  userActions?: PipReelUserActions;
  /** `pip`: PiP iframe (Open in main). `page`: full `/reel/:uniqueId` route. */
  variant?: PipReelItemVariant;
  className?: string;
  /**
   * Reel page perf: when false, show a static poster instead of mounting HLS (avoids N decoders).
   * Pass `isActive || isVisible` from Swiper. Defaults to true (PiP / vertical-feed keep full player).
   */
  loadHlsPlayer?: boolean;
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

function PipReelItemInner({
  file,
  isActive,
  showChrome = true,
  userActions,
  variant = 'pip',
  className,
  loadHlsPlayer = true,
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

  const fileIdNorm = useMemo(() => String(file.id).toLowerCase(), [file.id]);
  const likedSig = userActions
    ? [...userActions.likedFileIds].map((id) => String(id).toLowerCase()).sort().join(',')
    : '';
  const dislikedSig = userActions
    ? [...userActions.dislikedFileIds].map((id) => String(id).toLowerCase()).sort().join(',')
    : '';

  const likedFromActions = userActions
    ? new Set(userActions.likedFileIds.map((id) => String(id).toLowerCase())).has(fileIdNorm)
    : false;
  const dislikedFromActions = userActions
    ? new Set(userActions.dislikedFileIds.map((id) => String(id).toLowerCase())).has(fileIdNorm)
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
    const id = fileIdNorm;
    if (userActions) {
      setLiked(new Set(userActions.likedFileIds.map((x) => String(x).toLowerCase())).has(id));
      setDisliked(new Set(userActions.dislikedFileIds.map((x) => String(x).toLowerCase())).has(id));
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
  }, [
    fileIdNorm,
    file.like_count,
    file.dislike_count,
    file.views,
    file.view_count,
    likedSig,
    dislikedSig,
    item.liked,
    item.disliked,
  ]);

  useWatchTracking({
    fileId: String(file.id),
    userId,
    isVideo,
    videoElement: trackedVideoEl,
    source: variant === 'page' ? 'reel_page' : 'pip_reel',
  });

  useEffect(() => {
    const v = trackedVideoEl ?? videoRef.current;
    if (!v || !isVideo) return;
    if (isActive) {
      void v.play().catch(() => {});
    } else if (!v.paused) {
      v.pause();
    }
  }, [isActive, isVideo, trackedVideoEl]);

  useEffect(() => {
    if (variant !== 'page' || !isActive || !file.unique_id) return;
    const display =
      (file.file_title?.trim() || ParseFilename(file.filename || '')) || 'Reel';
    window.history.replaceState(
      null,
      '',
      `/reel/${encodeURIComponent(file.unique_id)}`,
    );
    document.title = `${display} | Memories`;
  }, [variant, isActive, file.unique_id, file.file_title, file.filename]);

  useEffect(() => {
    if (!isActive || variant !== 'page' || !file.id || !file.unique_id) return;
    fetch('/api/views/watch-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: file.id, uniqueId: file.unique_id }),
      credentials: 'include',
    }).catch(() => {});
  }, [isActive, variant, file.id, file.unique_id]);

  const requiredViewSeconds = useMemo(() => {
    if (isHLS && file.duration != null && Number(file.duration) > 0) {
      const d = Number(file.duration);
      const half = Math.ceil(d * 0.5);
      return Math.min(30, Math.max(3, half));
    }
    return 30;
  }, [isHLS, file.duration]);

  const runViewIncrement = useCallback((currentTimeSeconds?: number, durationSeconds?: number) => {
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
      currentTimeSeconds: typeof currentTimeSeconds === 'number' ? currentTimeSeconds : requiredViewSeconds,
      durationSeconds:
        typeof durationSeconds === 'number'
          ? durationSeconds
          : file.duration != null
            ? Number(file.duration)
            : undefined,
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

  const onVideoTimeForView = useCallback(() => {
    if (hasIncrementedView || viewIncrementSentRef.current) return;
    const v = trackedVideoEl ?? videoRef.current;
    if (!v || !Number.isFinite(v.currentTime)) return;
    if (v.currentTime >= requiredViewSeconds) {
      runViewIncrement(v.currentTime, Number.isFinite(v.duration) ? v.duration : undefined);
    }
  }, [hasIncrementedView, requiredViewSeconds, runViewIncrement, trackedVideoEl]);

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
    onVideoTimeForView();
  }, [onVideoTimeForView]);

  useEffect(() => {
    const v = trackedVideoEl ?? videoRef.current;
    if (!v) return;
    v.addEventListener('timeupdate', onVideoTimeForView);
    return () => v.removeEventListener('timeupdate', onVideoTimeForView);
  }, [trackedVideoEl, onVideoTimeForView]);

  const fileId = item.fileId ?? item.id;
  const uniqueId = item.unique_id ?? item.id;
  const isOwner = Boolean(userId && item.ownerId && userId === item.ownerId);

  const videoSrc = isVideoLikeFile(file)
    ? getVideoSrc(file.endpoint ?? '', file.file_type)
    : undefined;

  const showHls = Boolean(videoSrc) && (variant === 'pip' || loadHlsPlayer);

  const posterUrl = useMemo(() => {
    if (!file.created_at || !file.unique_id) return '';
    try {
      return getThumbnailUrl(file, { queryString: '?quality=50' });
    } catch {
      return '';
    }
  }, [
    file.created_at,
    file.unique_id,
    file.default_thumbnail,
    file.thumbnails,
    file.file_type,
    file.endpoint,
    file.filename,
  ]);

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
        'relative flex h-full min-h-0 w-full shrink-0 flex-col',
        variant === 'page' ? 'bg-black' : 'bg-background reel_p',
        isActive && variant !== 'page' && 'ring-1 ring-border',
        className,
      )}
      data-pip-reel-item-id={item.id}
    >
      {/*
        Video well. Actions float over the video (bottom-right) TikTok-style — no separate rail.
        Swiper steals pointer events on slides, so the Actions wrapper opts out via `swiper-no-swiping`
        and sits in its own z-layer so Radix dropdowns inside `Actions` still work.
      */}
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-black">
        {videoSrc && showHls ? (
          <PlayQueueProvider
            currentUniqueId={file.unique_id}
            seriesUpNextVideos={[]}
            suggestedVideos={[]}
            viewerCanCustomizeQueue={Boolean(userId)}
          >
            <DynamicHLSPlayerWithQueue
              key={file.unique_id ?? file.id}
              src={videoSrc}
              videoRef={videoRef}
              className="h-full w-full"
              autoPlay={isActive}
              reelSwiperActive={isActive}
              muted={false}
              unlockPipReelAudio
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
        ) : videoSrc && !showHls ? (
          <div className="flex h-full w-full items-center justify-center bg-black">
            {posterUrl ? (
              <img
                src={posterUrl}
                alt=""
                className="h-full w-full object-contain"
                decoding="async"
                fetchPriority="low"
              />
            ) : (
              <div className="h-12 w-12 animate-pulse rounded-full bg-white/10" aria-hidden />
            )}
          </div>
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
            sharePagePath={fileWatchPath(file)}
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
        <div
          className={cn(
            'shrink-0 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
            variant === 'page'
              ? 'border-white/10 bg-black/90 text-white [&_.text-muted-foreground]:text-white/65'
              : 'border-border bg-card',
          )}
        >
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              {file.owner?.username ? (
                <OwnerProfile
                  owner={file.owner}
                  size="sm"
                  showUsername
                  className={
                    variant === 'page'
                      ? 'text-white [&_span]:text-white hover:text-white [&_span]:hover:text-white'
                      : 'text-foreground [&_span]:text-foreground hover:text-foreground [&_span]:hover:text-foreground'
                  }
                />
              ) : (
                <p
                  className={cn(
                    'truncate text-sm font-semibold',
                    variant === 'page' ? 'text-white' : 'text-foreground',
                  )}
                >
                  @{item.username || '…'}
                </p>
              )}
            </div>

            {variant === 'pip' ? (
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
            ) : null}
          </div>

          <div
            className={cn(
              'mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] sm:text-xs',
              variant === 'page' ? 'text-white/70' : 'text-muted-foreground',
            )}
          >
            <span
              className={cn(
                'font-medium tabular-nums',
                variant === 'page' ? 'text-white' : 'text-foreground',
              )}
            >
              {formatNumber(views)} views
            </span>
            {file.created_at ? (
              <>
                <span className="opacity-50" aria-hidden>
                  ·
                </span>
                <span>{formatTimeAgo(file.created_at)}</span>
              </>
            ) : null}
          </div>

          {file.file_title?.trim() || file.filename ? (
            <p
              className={cn(
                'mt-1.5 truncate text-sm font-semibold leading-tight',
                variant === 'page' ? 'text-white' : 'text-foreground',
              )}
            >
              <ParseFilenameInsert
                filename={file.file_title?.trim() || file.filename || ''}
                className={variant === 'page' ? '[&_a]:text-white [&_a]:underline' : undefined}
              />
            </p>
          ) : null}

          {item.caption?.trim() ? (
            <div
              className={cn(
                'mt-1 line-clamp-2 text-sm leading-snug',
                variant === 'page' ? 'text-white/80' : 'text-muted-foreground',
              )}
            >
              <FormattedText
                text={item.caption.trim()}
                className={variant === 'page' ? 'text-white/80 [&_a]:text-white' : undefined}
              />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export const PipReelItem = memo(PipReelItemInner);
