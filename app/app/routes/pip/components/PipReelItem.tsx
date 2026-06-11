import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { isMobile } from 'react-device-detect';
import { Maximize2 } from 'lucide-react';
import { cn, getThumbnailUrl, getVideoSrc, ParseFilename } from '~/lib/utils';
import {
  REEL_FALLBACK_ASPECT,
  readVideoAspectRatio,
  reelVideoFrameStyle,
} from '~/lib/reel/reelVideoFrame';
import { usePlaybackUrl } from '~/lib/hooks/usePlaybackUrl';
import ParseFilenameInsert from '~/lib/utils/ShowFileName';
import { FormattedText } from '~/components/FormattedText';
import { formatNumber } from '~/lib/utils/formatNumber';
import { formatTimeAgo } from '~/lib/formatTimeAgo';
import { useWatchTracking } from '~/lib/hooks/useWatchTracking';
import { Button } from '~/components/ui/button';
import { DynamicHLSPlayerWithQueue } from '~/routes/Dynamic/components/DynamicHLSPlayerWithQueue';
import { PlayQueueProvider } from '~/routes/Dynamic/components/PlayQueueContext';
import Actions from '~/routes/Home/components/VideoCard/Actions';
import ImageLoad from '~/routes/Home/components/ImageLoad/ImageLoad';
import { ReelMetaPanel } from '~/routes/reel/components/ReelMetaPanel';
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
  /** `/reel` full-page only: poster-derived palette for the page backdrop (from the same thumbnail as the player). */
  onReelPosterColors?: (colors: string[]) => void;
}

const noopRetry = () => {};

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
  onReelPosterColors,
}: PipReelItemProps) {
  const { userId } = useFileContext();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  /** Drives `useWatchTracking` when the HLS `<video>` mounts (ref alone doesn’t re-render). */
  const [trackedVideoEl, setTrackedVideoEl] = useState<HTMLVideoElement | null>(null);
  /** Intrinsic W/H from the active `<video>` — sizes the reel frame on `/reel`. */
  const [videoAspect, setVideoAspect] = useState<number | null>(null);
  const [isReelMobileLayout, setIsReelMobileLayout] = useState(isMobile);

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
    setVideoAspect(null);
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

    if (!isActive) {
      if (!v.paused) v.pause();
      return;
    }

    // Robust autoplay for reels  the active slide must NEVER stay paused.
    // Things that break naive autoplay on mobile:
    //   1. Fast scrolling makes this slide's play() race the previous slide's
    //      pause() → AbortError.
    //   2. After a few slides the browser revokes audible-autoplay permission
    //      → play() rejects with NotAllowedError.
    //   3. iPhone Safari: after sustained scrolling the media decoder pool is
    //      starved  play() rejects (or the element just isn't ready) until a
    //      retired pipeline frees up. A handful of fast retries is NOT enough
    //      here; the old 3×120ms burned out and the slide stayed frozen.
    // Strategy (TikTok-style): retry transient errors on a patient heartbeat
    // until the FIRST successful start (never fighting a user pause after
    // that), re-attempt the moment the media reports ready, and fall back to
    // MUTED playback when sound is blocked  restoring sound on the next tap.
    let cancelled = false;
    let started = false;
    let heartbeatTries = 12;
    let heartbeatId: number | null = null;

    const cleanupGesture = () => {
      document.removeEventListener('pointerdown', onUnmuteGesture);
      document.removeEventListener('touchend', onUnmuteGesture);
    };
    const onUnmuteGesture = () => {
      cleanupGesture();
      if (cancelled || !isActive) return;
      const el = trackedVideoEl ?? videoRef.current;
      if (!el) return;
      // The video is already playing (muted fallback) — a genuine interaction
      // lets us bring the sound back without interrupting playback.
      if (el.muted) el.muted = false;
      if (el.paused) void el.play().catch(() => {});
    };
    const armUnmuteGesture = () => {
      cleanupGesture();
      document.addEventListener('pointerdown', onUnmuteGesture, { once: true, passive: true });
      document.addEventListener('touchend', onUnmuteGesture, { once: true, passive: true });
    };

    const onPlaying = () => {
      started = true;
      stopHeartbeat();
    };

    const stopHeartbeat = () => {
      if (heartbeatId != null) {
        window.clearInterval(heartbeatId);
        heartbeatId = null;
      }
    };
    // Patient recovery: every 700ms until the reel has started once. Covers
    // decoder starvation (iOS) and slow native-HLS readiness without ever
    // overriding a deliberate user pause (started flips it off for good).
    const startHeartbeat = () => {
      if (heartbeatId != null) return;
      heartbeatId = window.setInterval(() => {
        if (cancelled || started || heartbeatTries-- <= 0) {
          stopHeartbeat();
          return;
        }
        if (v.paused) attempt();
      }, 700);
    };

    const playMutedFallback = () => {
      if (cancelled) return;
      v.muted = true;
      v.play()
        .then(() => {
          if (cancelled) return;
          armUnmuteGesture();
        })
        .catch(() => {
          if (!cancelled && !started) startHeartbeat();
        });
    };

    const attempt = () => {
      if (cancelled || !isActive) return;
      const p = v.play();
      if (p && typeof p.then === 'function') {
        p.catch((err: unknown) => {
          if (cancelled || !v.paused) return; // already recovered
          const name =
            err && typeof err === 'object' && 'name' in err
              ? String((err as { name: string }).name)
              : '';
          if (name === 'NotAllowedError') {
            // Audible autoplay blocked → keep playing muted instead of pausing.
            playMutedFallback();
          } else if (!started) {
            startHeartbeat();
          }
        });
      }
    };

    // The instant the element becomes ready (decoder freed / segments landed),
    // try again — much faster than waiting for the next heartbeat tick.
    const onReady = () => {
      if (!cancelled && !started && v.paused) attempt();
    };
    v.addEventListener('playing', onPlaying);
    v.addEventListener('canplay', onReady);
    v.addEventListener('loadeddata', onReady);

    attempt();
    if (v.paused) startHeartbeat();

    return () => {
      cancelled = true;
      stopHeartbeat();
      cleanupGesture();
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('canplay', onReady);
      v.removeEventListener('loadeddata', onReady);
    };
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

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 1023px)');
    const update = () => setIsReelMobileLayout(isMobile || mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (variant !== 'page' || isReelMobileLayout) return;
    const v = trackedVideoEl ?? videoRef.current;
    if (!v) return;

    const syncAspect = () => {
      const ar = readVideoAspectRatio(v.videoWidth, v.videoHeight);
      if (ar) setVideoAspect(ar);
    };

    syncAspect();
    v.addEventListener('loadedmetadata', syncAspect);
    v.addEventListener('loadeddata', syncAspect);
    v.addEventListener('resize', syncAspect);

    return () => {
      v.removeEventListener('loadedmetadata', syncAspect);
      v.removeEventListener('loadeddata', syncAspect);
      v.removeEventListener('resize', syncAspect);
    };
  }, [variant, isReelMobileLayout, trackedVideoEl, fileIdNorm]);

  const reelFrameStyle = useMemo(() => {
    if (variant !== 'page' || isReelMobileLayout) return undefined;
    return reelVideoFrameStyle(videoAspect ?? REEL_FALLBACK_ASPECT, {
      maxHeight: 'min(calc(100dvh - 0.5rem), 920px)',
      maxWidth: 'min(100%, calc(100vw - 14rem))',
    });
  }, [variant, videoAspect, isReelMobileLayout]);

  const handleReelPosterColorsFromPlayer = useCallback(
    (payload: { src: string; colors: string[] }) => {
      if (variant !== 'page' || !isActive) return;
      onReelPosterColors?.(payload.colors ?? []);
    },
    [variant, isActive, onReelPosterColors],
  );

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

  // Same JIT-mint flow as the main reel  see ~/lib/hooks/usePlaybackUrl.
  const playbackUrl = usePlaybackUrl(file);
  const videoSrc = isVideoLikeFile(file)
    ? getVideoSrc(file.endpoint ?? '', file.file_type, playbackUrl)
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
   * "Open in main"  leaves the PiP iframe and navigates the main window to `/{unique_id}`.
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

    // If we're not inside a PiP iframe and have no opener, nothing heard those messages  go local.
    if (
      typeof window !== 'undefined' &&
      window.parent === window &&
      !window.opener
    ) {
      navigate(href);
    }
  }, [file.unique_id, navigate]);

  // Instagram-style audio-art tile in the action rail: the ORIGINAL's
  // thumbnail when this reel's sound matched one (own thumbnail otherwise),
  // clicking through to the sound page. Reuses the shared thumbnail loader
  // (IndexedDB cache + fallbacks) instead of a bare <img>.
  const originalSound = (file as FileType).original_sound;
  const reelAudioArt = (
    <Link
      to={`/music/${encodeURIComponent(String(file.original_file_id ?? file.id))}`}
      onClick={(e) => e.stopPropagation()}
      className="block h-full w-full"
      aria-label="See videos using this sound"
    >
      <ImageLoad
        link={
          originalSound?.created_at
            ? getThumbnailUrl(
                {
                  default_thumbnail: originalSound.default_thumbnail,
                  thumbnails: null,
                  created_at: originalSound.created_at,
                  unique_id: originalSound.unique_id,
                  filename: originalSound.filename || '',
                },
              )
            : getThumbnailUrl(file)
        }
        imageID={`${originalSound?.unique_id ?? file.unique_id}_reel_audio_art`}
        index={0}
        retry={noopRetry}
        className="h-full w-full object-cover"
        quality={10}
        hasAdultTag={Boolean(file.is_adult)}
      />
    </Link>
  );

  const actionsEl = (
    <Actions
      layout="tiktok"
      instagramStyle
      reelAudioArt={reelAudioArt}
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
  );

  const reelInfoSlot =
    variant === 'page' && showChrome ? (
      <ReelMetaPanel file={file} item={item} views={views} />
    ) : undefined;

  const videoPlayerEl =
    videoSrc && showHls ? (
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
          disableKeyboardShortcuts={variant === 'page'}
          reelInfoSlot={reelInfoSlot}
          onPlay={handleVideoPlay}
          onVideoRef={handlePlayerVideoRef}
          callBack={variant === 'page' ? handleReelPosterColorsFromPlayer : undefined}
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
            // Eager + default priority: Swiper only keeps a small window of
            // slides mounted, so nearby reel posters load ahead and the
            // thumbnail is already there the moment the user swipes to it.
            loading="eager"
          />
        ) : (
          <div className="h-12 w-12 animate-pulse rounded-full bg-white/10" aria-hidden />
        )}
      </div>
    ) : (
      <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
        <span className="text-sm font-medium">Preview unavailable</span>
      </div>
    );

  if (variant === "page") {
    return (
      <div
        className={cn(
          "relative flex h-full min-h-0 w-full shrink-0 flex-col bg-transparent",
          className,
        )}
        data-pip-reel-item-id={item.id}
      >
        <div className="flex h-full min-h-0 w-full items-center justify-center max-lg:items-stretch max-lg:justify-stretch">
          <div
            className={cn(
              "relative flex h-full w-full max-w-full flex-row items-center justify-center gap-3 lg:gap-4 lg:px-6",
              "max-lg:gap-0 max-lg:px-0",
            )}
          >
            <div
              className={cn(
                "relative shrink-0 overflow-hidden bg-black",
                "max-lg:h-[100dvh] max-lg:min-h-[100dvh] max-lg:max-h-[100dvh] max-lg:w-full max-lg:max-w-full",
                "lg:max-w-full lg:transition-[width,height] lg:duration-300 lg:ease-out",
                "max-lg:rounded-none",
                "lg:rounded-2xl lg:shadow-[0_25px_80px_-15px_rgba(0,0,0,0.9)] lg:ring-1 lg:ring-white/10",
              )}
              style={reelFrameStyle}
            >
              {videoPlayerEl}

              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 z-[11] h-24 bg-gradient-to-b from-black/60 via-black/20 to-transparent"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-0 z-[11] w-[30%] max-w-[7rem] bg-gradient-to-l from-black/35 to-transparent lg:hidden"
              />

              {showChrome ? (
                <div
                  className={cn(
                    "swiper-no-swiping pointer-events-auto absolute z-20 flex flex-col items-center lg:hidden",
                    "right-[max(0.5rem,env(safe-area-inset-right))]",
                    // Anchor to the bottom (above the caption / embedded info) like
                    // Instagram, instead of vertically centered (which sat too high).
                    "bottom-[calc(5rem+env(safe-area-inset-bottom,0px))]",
                  )}
                >
                  {actionsEl}
                </div>
              ) : null}
            </div>

            {showChrome ? (
              <div className="swiper-no-swiping pointer-events-auto z-30 hidden shrink-0 flex-col items-center lg:flex">
                {actionsEl}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative flex h-full min-h-0 w-full shrink-0 flex-col',
        'bg-background reel_p',
        isActive && 'ring-1 ring-border',
        className,
      )}
      data-pip-reel-item-id={item.id}
    >
      {/*
        PiP: actions over the video (bottom-right). Page variant uses the layout branch above.
      */}
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-black">
        {videoPlayerEl}

        <div
          aria-hidden
          className="pointer-events-none absolute right-0 top-0 w-20 bg-gradient-to-l from-black/35 to-transparent"
          style={{ bottom: 'calc(3.25rem + env(safe-area-inset-bottom, 0px))' }}
        />

        <div
          className={cn(
            'swiper-no-swiping pointer-events-auto absolute right-0 z-20',
            'bottom-[calc(3.75rem+env(safe-area-inset-bottom,0px))]',
            'flex flex-col items-end',
            'px-2 pt-2',
          )}
        >
          {actionsEl}
        </div>
      </div>

      {showChrome ? (
        <div className="shrink-0 border-border border-t bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-foreground">
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
                <span className="opacity-50" aria-hidden>
                  ·
                </span>
                <span>{formatTimeAgo(file.created_at)}</span>
              </>
            ) : null}
          </div>

          {file.file_title?.trim() || file.filename ? (
            <p className="mt-1.5 truncate text-sm font-semibold leading-tight text-foreground">
              <ParseFilenameInsert filename={file.file_title?.trim() || file.filename || ''} />
            </p>
          ) : null}

          {item.caption?.trim() ? (
            <div className="mt-1 line-clamp-2 text-sm leading-snug text-muted-foreground">
              <FormattedText text={item.caption.trim()} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export const PipReelItem = memo(PipReelItemInner);
