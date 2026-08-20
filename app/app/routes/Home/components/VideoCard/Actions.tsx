import { useCallback, useEffect, useState, type ReactNode } from "react";
import { isMobile } from "react-device-detect";
import { Link, useNavigate, useParams } from "react-router";
import {
  ThumbsUp,
  ThumbsDown,
  Heart,
  Send,
  MessageCircle,
  Share2,
  Link2,
  Loader2,
  MoreHorizontal,
  MoreVertical,
  ListPlus,
  Check,
  ListVideo,
  Plus,
  Pencil,
  Bookmark,
  MoveVertical,
  Trash2,
  Flag,
  EyeOff,
  UserMinus,
} from "lucide-react";
import { ReportDialog } from "~/components/ReportDialog";
import { hideFromFeed } from "~/lib/feedPreferences.client";
import { formatNumber } from "~/lib/utils/formatNumber";
import { useRateLimit } from "~/lib/hooks/useRateLimit";
import { ShareModal } from "~/components/ShareModal";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuCollapsible,
  DropdownMenuCollapsibleContent,
  DropdownMenuCollapsibleTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";
import CreatePlaylistModal from "~/components/Playlist/CreatePlaylistModal";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerOverlay,
  DrawerTitle,
} from "~/components/ui/drawer";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import CommentSection from "~/routes/Dynamic/components/Comments/CommentSection";
import { useLocalPlaylist, normalizeLocalPlaylistFileId } from "~/lib/hooks/useLocalPlaylist";
import { useFileContext } from "~/lib/Context/Context";
import { personalizationService } from "~/lib/Services/PersonalizationService";
import { playbackPositionField } from '~/lib/playback/positionRegistry';

export interface ActionsProps {
  fileId: string;
  uniqueId: string;
  likeCount: number;
  dislikeCount: number;
  commentCount: number;
  liked: boolean;
  disliked: boolean;
  isOwner: boolean;
  isAdult?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onUpdate?: (updates: {
    liked: boolean;
    disliked: boolean;
    like_count: number;
    dislike_count: number;
  }) => void;
  /** If set, called when building the share URL so `?t=seconds` matches live playback (HLS). */
  getShareTimestamp?: () => number;
  /**
   * After a successful native share or copy, we try to record it server-side.
   * If `serverCount` is provided, use that value; otherwise increment locally (e.g. optimistic +1).
   */
  onShareSuccess?: (serverCount?: number) => void;
  /**
   * Canonical page path for share/copy link (leading slash), e.g. `/reel/my-slug` or `/abc-uuid`.
   * Defaults to `/${uniqueId}` when omitted.
   */
  sharePagePath?: string;
  /** Logged-in user id from the page loader; playlist submenu loads lists when this is set. */
  currentUserId?: string | null;
  /** File `created_at` for comment image uploads (GitHub path under the post folder). */
  fileCreatedAt?: string | null;
  /** Current playback time for share modal timestamp feature */
  currentTime?: number;
  fileOwnerId?: string;
  commentsEnabled?: boolean;
  highlightCommentId?: string | null;
  /**
   * When `onCommentsOpenChange` is set, the comments drawer/dialog open state is controlled by the parent
   * (e.g. a large mobile “Comments” card on the watch page).
   */
  commentsOpen?: boolean;
  onCommentsOpenChange?: (open: boolean) => void;
  /** Forwarded to the embedded CommentSection so posts/deletes here update the visible count. */
  onCommentCountDelta?: (delta: number) => void;
  /**
   * When true, the comment button still toggles `onCommentsOpenChange`, but
   * Actions does NOT render its own drawer/dialog  the PARENT renders the
   * comments UI (e.g. the desktop reel renders a side-by-side panel). Prevents
   * double-rendering when the action rail is mounted more than once.
   */
  suppressCommentsUi?: boolean;
  /**
   * Visual layout.
   * - `default`: horizontal pill row. Share/Save pills only on the watch page main row; feed cards use More.
   * - `reel`: vertical stack of circular icon buttons (reels shell).
   * - `tiktok`: same as `reel` (alias for PiP / vertical-feed).
   * - `shortsShelf`: only the ⋮ menu (YouTube Shorts–style shelf tile).
   */
  layout?: "default" | "reel" | "tiktok" | "shortsShelf";
  howLikesDislikeComments?: boolean;
  /**
   * Instagram-style reel rail: drops the dislike, uses a heart for likes and a
   * paper-plane for share, and (when `reelAudioArt` is set) shows an audio
   * thumbnail at the bottom. Only affects `reel`/`tiktok` layouts.
   */
  instagramStyle?: boolean;
  /**
   * Audio/album art element for the bottom of the IG rail. Pass the shared
   * thumbnail loader (e.g. `ImageLoad`) so it reuses the existing fail-safe /
   * caching handling instead of a bare `<img>`.
   */
  reelAudioArt?: ReactNode;
  /** Shrinks spacing and labels on short viewports (reel / tiktok layouts only). */
  reelDensity?: "comfortable" | "compact" | "minimal";
  /** Ref to the reel like icon (for double-tap fly-to-target animation). */
  reelLikeIconRef?: React.RefObject<HTMLSpanElement | null>;
}

type InteractionResponse = {
  liked?: boolean;
  disliked?: boolean;
  like_count?: number;
  dislike_count?: number;
  user_has_liked?: boolean;
  user_has_disliked?: boolean;
};

type UserPlaylist = {
  id: string;
  title: string;
  unique_id: string;
  item_count: number;
};

function normalizeInteraction(json: InteractionResponse | null): {
  liked: boolean;
  disliked: boolean;
  like_count: number;
  dislike_count: number;
} | null {
  if (!json) return null;
  const liked = json.liked ?? json.user_has_liked ?? false;
  const disliked = json.disliked ?? json.user_has_disliked ?? false;
  const like_count = Number(json.like_count) || 0;
  const dislike_count = Number(json.dislike_count) || 0;
  return { liked, disliked, like_count, dislike_count };
}

async function postInteraction(
  url: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; json: InteractionResponse | null; status: number }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });
  let json: InteractionResponse | null = null;
  try {
    const text = await res.text();
    if (text) json = JSON.parse(text) as InteractionResponse;
  } catch {
    json = null;
  }
  return { ok: res.ok, json, status: res.status };
}

/** Path from site root, e.g. `/uuid` or `/reel/slug` (each segment encoded). */
function buildPageShareUrl(pathFromRoot: string, seconds?: number) {
  if (typeof window === "undefined") return "";
  const trimmed = pathFromRoot.replace(/^\//, "");
  const segments = trimmed.split("/").filter(Boolean);
  const path = segments.length ? `/${segments.map(encodeURIComponent).join("/")}` : "";
  const base = `${window.location.origin}${path}`;
  if (seconds != null && Number.isFinite(seconds) && seconds > 1) {
    return `${base}?t=${Math.floor(seconds)}`;
  }
  return base;
}

export default function Actions({
  fileId,
  uniqueId,
  likeCount,
  dislikeCount,
  commentCount,
  liked,
  disliked,
  isOwner,
  isAdult,
  onEdit,
  onDelete,
  onUpdate,
  getShareTimestamp,
  onShareSuccess,
  sharePagePath,
  currentUserId,
  currentTime,
  fileCreatedAt,
  fileOwnerId,
  commentsEnabled = true,
  highlightCommentId = null,
  commentsOpen: commentsOpenProp,
  onCommentsOpenChange,
  onCommentCountDelta,
  suppressCommentsUi = false,
  layout = "default",
  howLikesDislikeComments = true,
  instagramStyle = false,
  reelAudioArt,
  reelDensity = "comfortable",
  reelLikeIconRef,
}: ActionsProps) {
  const navigate = useNavigate();
  const { setFiles } = useFileContext();
  const [likeBusy, setLikeBusy] = useState(false);
  const [dislikeBusy, setDislikeBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [canWebShare, setCanWebShare] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
  const [addedTo, setAddedTo] = useState<Set<string>>(() => new Set());
  const [playlistLoad, setPlaylistLoad] = useState<"idle" | "loading" | "error" | "done">("idle");
  const [playlistError, setPlaylistError] = useState("");
  const [addingPlaylistId, setAddingPlaylistId] = useState<string | null>(null);
  const [createPlaylistOpen, setCreatePlaylistOpen] = useState(false);
  const [internalCommentsOpen, setInternalCommentsOpen] = useState(false);
  const [likeButtonPop, setLikeButtonPop] = useState(false);
  const isCommentsControlled = typeof onCommentsOpenChange === "function";
  const commentsPanelOpen = isCommentsControlled ? Boolean(commentsOpenProp) : internalCommentsOpen;
  const setCommentsPanelOpen = useCallback(
    (open: boolean) => {
      if (isCommentsControlled) onCommentsOpenChange!(open);
      else setInternalCommentsOpen(open);
    },
    [isCommentsControlled, onCommentsOpenChange],
  );

  useEffect(() => {
    if (!isMobile || !highlightCommentId) return;
    setCommentsPanelOpen(true);
  }, [highlightCommentId, isMobile, setCommentsPanelOpen]);

  const routeParams = useParams();
  const routeDynamicId = routeParams.id;
  const routeReelUniqueId = routeParams.uniqueId;
  const pagePathForShare = sharePagePath ?? `/${uniqueId}`;
  const isOnThisFilePage = Boolean(
    (routeDynamicId &&
      (routeDynamicId === uniqueId || routeDynamicId === fileId)) ||
      (routeReelUniqueId && routeReelUniqueId === uniqueId),
  );
  /** Watch page main actions row — not feed cards, sidebar, or related tiles. */
  const shareSaveInRow = isOnThisFilePage && layout === "default";
  const { has: hasLocalSave, add: addLocalSave, remove: removeLocalSave } = useLocalPlaylist();
  const effectiveLocalFileId = normalizeLocalPlaylistFileId(fileId);
  const inLocalList = Boolean(effectiveLocalFileId && hasLocalSave(effectiveLocalFileId));


  const pulseLikeButton = useCallback(() => {
    setLikeButtonPop(true);
    window.setTimeout(() => setLikeButtonPop(false), 520);
  }, []);

  useEffect(() => {
    setCanWebShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  useEffect(() => {
    setPlaylists([]);
    setAddedTo(new Set());
    setPlaylistLoad("idle");
    setPlaylistError("");
  }, [fileId, currentUserId]);

  const requireAuth = useCallback(() => {
    const next = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/";
    navigate(`/auth/login?redirect=${encodeURIComponent(next)}`);
  }, [navigate]);

  const loadPlaylistData = useCallback(async () => {
    if (!currentUserId) return;
    setPlaylistLoad("loading");
    setPlaylistError("");
    try {
      const [playlistsRes, containsRes] = await Promise.all([
        fetch("/api/playlists", { credentials: "include" }),
        fetch(`/api/playlists/contains?file_id=${encodeURIComponent(fileId)}`, { credentials: "include" }),
      ]);
      const playlistsJson = await playlistsRes.json();
      if (!playlistsRes.ok) {
        if (playlistsRes.status === 401) {
          requireAuth();
          setPlaylistLoad("idle");
          return;
        }
        setPlaylistError(String(playlistsJson.error || "Could not load playlists"));
        setPlaylistLoad("error");
        return;
      }
      setPlaylists(Array.isArray(playlistsJson.playlists) ? playlistsJson.playlists : []);
      if (containsRes.ok) {
        const containsJson = await containsRes.json();
        setAddedTo(new Set(containsJson.playlist_ids || []));
      } else {
        setAddedTo(new Set());
      }
      setPlaylistLoad("done");
    } catch {
      setPlaylistError("Network error");
      setPlaylistLoad("error");
    }
  }, [currentUserId, fileId, requireAuth]);

  const handlePlaylistToggle = useCallback(
    async (playlistId: string) => {
      if (!currentUserId) {
        requireAuth();
        return;
      }
      const isAdded = addedTo.has(playlistId);
      setAddingPlaylistId(playlistId);
      try {
        const res = await fetch(`/api/playlists/${playlistId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(
            isAdded ? { action: "remove", file_id: fileId } : { file_id: fileId },
          ),
        });
        if (res.status === 401) {
          requireAuth();
          return;
        }
        if (res.ok || (!isAdded && res.status === 409)) {
          setAddedTo((prev) => {
            const next = new Set(prev);
            if (isAdded) next.delete(playlistId);
            else next.add(playlistId);
            return next;
          });
          if (res.ok) {
            setPlaylists((prev) =>
              prev.map((p) => {
                if (p.id !== playlistId) return p;
                if (isAdded) return { ...p, item_count: Math.max(0, p.item_count - 1) };
                return { ...p, item_count: p.item_count + 1 };
              }),
            );
          }
        }
      } catch {
        /* ignore */
      } finally {
        setAddingPlaylistId(null);
      }
    },
    [addedTo, currentUserId, fileId, requireAuth],
  );

  // One shared bounce limit for the like/dislike pair, so rapidly toggling (or
  // flipping like↔dislike) can't flood /api/likes. ~600ms is below human
  // intentional-tap speed but kills mashing.
  const { attempt: attemptInteraction } = useRateLimit(600);

  const applyLikeDislike = useCallback(
    async (kind: "like" | "dislike") => {
      if (!onUpdate) {
        requireAuth();
        return;
      }
      if (!attemptInteraction()) return;
      const setBusy = kind === "like" ? setLikeBusy : setDislikeBusy;
      setBusy(true);
      const url = kind === "like" ? "/api/likes" : "/api/dislikes";
      const { ok, json, status } = await postInteraction(url, { fileId, ...playbackPositionField(fileId) });
      setBusy(false);
      if (status === 401) {
        requireAuth();
        return;
      }
      const norm = normalizeInteraction(json);
      if (ok && norm) {
        // Steer the in-session feed toward what the user just liked.
        const cats = (json as { categories?: unknown } | null)?.categories;
        if (kind === "like" && norm.liked && Array.isArray(cats)) {
          personalizationService.trackSessionLike(cats as string[]);
        }
        onUpdate(norm);
        return;
      }
      const alt = await postInteraction("/api/interactions", {
        fileId,
        action: kind === "like" ? "toggle_like" : "toggle_dislike",
      });
      const normAlt = normalizeInteraction(alt.json);
      if (alt.ok && normAlt) onUpdate(normAlt);
    },
    [fileId, onUpdate, requireAuth, attemptInteraction],
  );

  const recordShare = useCallback(async () => {
    if (!onShareSuccess) return;
    const attempts = [
      () => postInteraction("/api/interactions", { fileId, action: "share" }),
      () => postInteraction("/api/interactions", { fileId, type: "share" }),
      () => postInteraction("/api/interactions", { fileId, share: true }),
    ];
    for (const run of attempts) {
      const { ok, json } = await run();
      if (!ok || !json) continue;
      const raw = (json as { share_count?: number }).share_count;
      if (raw != null) {
        const n = Number(raw);
        if (!Number.isNaN(n)) {
          onShareSuccess(n);
          return;
        }
      }
      onShareSuccess();
      return;
    }
    onShareSuccess();
  }, [fileId, onShareSuccess]);

  const resolveShareSeconds = useCallback(() => {
    const t = getShareTimestamp?.();
    return t != null && Number.isFinite(t) ? t : undefined;
  }, [getShareTimestamp]);

  const onShareNative = useCallback(async () => {
    const url = buildPageShareUrl(pagePathForShare, resolveShareSeconds());
    if (!url) return;
    setShareBusy(true);
    try {
      if (navigator.share) {
        await navigator.share({
          title: document.title,
          url,
        });
        await recordShare();
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        /* user cancelled or error */
      }
    } finally {
      setShareBusy(false);
    }
  }, [pagePathForShare, resolveShareSeconds, recordShare]);

  const onCopyLink = useCallback(async () => {
    const url = buildPageShareUrl(pagePathForShare, resolveShareSeconds());
    if (!url) return;
    setShareBusy(true);
    try {
      await navigator.clipboard.writeText(url);
      await recordShare();
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        await recordShare();
      } catch {
        /* ignore */
      }
    } finally {
      setShareBusy(false);
    }
  }, [pagePathForShare, resolveShareSeconds, recordShare]);

  /** Reel share: native share sheet when available, else the share modal. */
  const openReelShare = useCallback(() => {
    if (canWebShare) void onShareNative();
    else setShareModalOpen(true);
  }, [canWebShare, onShareNative]);

  const openComments = useCallback(() => {
    if (isOnThisFilePage && !isMobile) {
      const el = document.getElementById("comments");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
    setCommentsPanelOpen(!commentsPanelOpen);
  }, [isOnThisFilePage, isMobile, commentsPanelOpen, setCommentsPanelOpen]);

  const onPlaylistSubOpenChange = useCallback(
    (open: boolean) => {
      if (!open) return;
      if (!currentUserId) return;
      if (playlistLoad === "loading" || playlistLoad === "done") return;
      void loadPlaylistData();
    },
    [currentUserId, playlistLoad, loadPlaylistData],
  );

  const pillOuter =
    `inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-border px-3 py-2 text-sm font-medium text-foreground shadow-sm transition hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 data-[state=open]:bg-accent/70`;

  const moreTriggerClass =
    `inline-flex size-9 shrink-0 items-center justify-center rounded-full ${howLikesDislikeComments ? `bg-card/80 border border-border ` : `bg-transparent`} text-foreground shadow-sm transition hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 data-[state=open]:bg-accent/70`;

  const countClass = "tabular-nums text-muted-foreground";

  const segmentBtn =
    "inline-flex flex-1 min-w-0 items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium transition hover:bg-accent/50 focus-visible:outline-none focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:opacity-50";

  const reelDensityCompact = reelDensity === "compact" || reelDensity === "minimal";
  const reelDensityMinimal = reelDensity === "minimal";

  /** YouTube-Shorts-style: glassy dark circle, white icon  no border/blur. */
  const reelIconBtn = cn(
    "flex items-center justify-center rounded-full bg-black/35 text-white transition active:scale-90 hover:bg-black/45 focus-visible:outline-none disabled:opacity-50",
    reelDensityMinimal ? "h-8 w-8" : reelDensityCompact ? "h-9 w-9" : "h-11 w-11",
  );

  const reelIconSize = reelDensityMinimal
    ? "h-[1.15rem] w-[1.15rem]"
    : reelDensityCompact
      ? "h-[1.25rem] w-[1.25rem]"
      : "h-[1.4rem] w-[1.4rem]";

  // Liked / disliked state is carried by the ICON (fill), not a button chrome.
  const reelIconBtnLiked = "text-white";
  const reelIconBtnDisliked = "text-white";

  const reelMoreTriggerClass = cn(
    "inline-flex shrink-0 items-center justify-center rounded-full bg-black/35 text-white transition active:scale-90 hover:bg-black/45 focus-visible:outline-none disabled:opacity-50 data-[state=open]:bg-black/55",
    reelDensityMinimal ? "size-8" : reelDensityCompact ? "size-9" : "size-11",
  );

  const reelLabel =
    "font-semibold tabular-nums tracking-tight text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]";

  const reelLabelClass = cn(
    reelLabel,
    reelDensityMinimal ? "text-[9px]" : reelDensityCompact ? "text-[10px]" : "text-[11px]",
  );

  const reelRowGapClass = reelDensityMinimal ? "gap-1.5" : reelDensityCompact ? "gap-2" : "gap-3";

  /** Hide non-essential text labels on very short screens; counts stay for like/comment. */
  const reelAuxLabel = (text: string) =>
    reelDensityMinimal ? null : <span className={reelLabelClass}>{text}</span>;

  const isShortsShelf = layout === "shortsShelf";
  const isReel = layout === "reel" || layout === "tiktok";

  const playlistSaveMenuBody = (
    <div
      className={cn(
        "max-h-[min(280px,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto overscroll-contain p-1.5",
        isReel && !isShortsShelf && "max-w-[calc(100vw-1.5rem)]",
      )}
    >
      <DropdownMenuCheckboxItem
        checked={inLocalList}
        disabled={!effectiveLocalFileId}
        onCheckedChange={(next) => {
          if (!effectiveLocalFileId) return;
          if (next) addLocalSave(effectiveLocalFileId);
          else removeLocalSave(effectiveLocalFileId);
        }}
      >
        <Bookmark className={cn("size-4", inLocalList && "fill-current")} aria-hidden />
        Save locally on this device
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator className="my-1" />
      {!currentUserId ? (
        <DropdownMenuItem onSelect={() => requireAuth()}>
          <ListPlus className="size-4" aria-hidden />
          Sign in to save to playlists
        </DropdownMenuItem>
      ) : playlistLoad === "loading" ? (
        <DropdownMenuItem disabled>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading playlists…
        </DropdownMenuItem>
      ) : playlistLoad === "error" ? (
        <>
          <DropdownMenuItem disabled className="text-muted-foreground">
            {playlistError}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void loadPlaylistData()}>Retry</DropdownMenuItem>
        </>
      ) : (
        <>
          {playlists.length === 0 ? (
            <DropdownMenuItem disabled className="text-muted-foreground">
              No playlists yet
            </DropdownMenuItem>
          ) : (
            playlists.map((pl) => {
              const isAdded = addedTo.has(pl.id);
              const busy = addingPlaylistId === pl.id;
              return (
                <DropdownMenuItem
                  key={pl.id}
                  disabled={addingPlaylistId !== null}
                  onSelect={() => void handlePlaylistToggle(pl.id)}
                  className="min-w-0 gap-2"
                >
                  {busy ? (
                    <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
                  ) : isAdded ? (
                    <Check className="size-4 shrink-0 text-primary" aria-hidden />
                  ) : (
                    <ListVideo className="size-4 shrink-0 opacity-70" aria-hidden />
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="min-w-0 flex-1 truncate cursor-default">
                        {pl.title}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      {pl.title}
                    </TooltipContent>
                  </Tooltip>
                  <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                    {pl.item_count}
                  </span>
                </DropdownMenuItem>
              );
            })
          )}
          <DropdownMenuSeparator className="my-1" />
          <DropdownMenuItem onSelect={() => setCreatePlaylistOpen(true)}>
            <Plus className="size-4" aria-hidden />
            New playlist…
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/playlist" className="cursor-pointer">
              <ListVideo className="size-4" aria-hidden />
              Manage playlists
            </Link>
          </DropdownMenuItem>
        </>
      )}
    </div>
  );

  const playlistSaveMenuCollapsible = (
    <DropdownMenuCollapsible onOpenChange={onPlaylistSubOpenChange}>
      <DropdownMenuCollapsibleTrigger className="min-w-[12rem]">
        <ListPlus className="size-4" aria-hidden />
        Add to playlist
      </DropdownMenuCollapsibleTrigger>
      <DropdownMenuCollapsibleContent flush>{playlistSaveMenuBody}</DropdownMenuCollapsibleContent>
    </DropdownMenuCollapsible>
  );

  const saveRowDropdown = shareSaveInRow ? (
    <DropdownMenu onOpenChange={onPlaylistSubOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(pillOuter, "max-md:hidden")}
          aria-pressed={inLocalList}
          aria-label={inLocalList ? "Saved" : "Save"}
        >
          <Bookmark
            className={cn("h-[1.125rem] w-[1.125rem] shrink-0", inLocalList && "fill-current")}
            aria-hidden
          />
          <span>{inLocalList ? "Saved" : "Save"}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={4}
        className="z-[200] min-w-[12rem] rounded-xl border-border/80 p-1 shadow-lg"
      >
        <DropdownMenuGroup>{playlistSaveMenuBody}</DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  const moreDropdown = (
    <DropdownMenu modal={!isReel || isShortsShelf}>
      <DropdownMenuTrigger asChild>
        {isShortsShelf ? (
          <button
            type="button"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-transparent text-muted-foreground transition-colors hover:border-border/50 hover:bg-muted/80 hover:text-foreground data-[state=open]:border-border/50 data-[state=open]:bg-muted/85 data-[state=open]:text-foreground dark:hover:bg-muted/50"
            aria-label="More options"
          >
            <MoreVertical className="size-4 shrink-0" strokeWidth={2} aria-hidden />
          </button>
        ) : isReel ? (
          <button
            type="button"
            className={`flex flex-col items-center gap-1`}
            aria-label="More options"
          >
            <span className={reelMoreTriggerClass}>
              <MoveVertical className="size-[1.125rem] shrink-0" aria-hidden />
            </span>
            <span className={reelLabel}>More</span>
          </button>
        ) : (
          <button type="button" className={`${moreTriggerClass}`} aria-label="More options">
            <MoreVertical className="size-[1.125rem] shrink-0" aria-hidden />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side={isReel && !isShortsShelf ? "top" : "bottom"}
        sideOffset={isReel && !isShortsShelf ? 8 : 4}
        className={cn(
          "z-[200] rounded-xl border-border/80 p-1 shadow-lg",
          isShortsShelf ? "min-w-[13.5rem]" : "min-w-[12rem]",
        )}
      >
          {isOwner && (typeof onEdit === "function" || typeof onDelete === "function") ? (
            <>
              <DropdownMenuGroup>
                {typeof onEdit === "function" && (
                  <DropdownMenuItem onSelect={() => onEdit()}>
                    <Pencil className="size-4" aria-hidden />
                    Edit upload
                  </DropdownMenuItem>
                )}
                {typeof onDelete === "function" && (
                  <DropdownMenuItem
                    onSelect={() => onDelete()}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="size-4" aria-hidden />
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={() => setShareModalOpen(true)}
              className={cn(shareSaveInRow && "max-md:hidden")}
            >
              <Share2 className="size-4" aria-hidden />
              Share
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!effectiveLocalFileId}
              className={cn(shareSaveInRow && "md:hidden")}
              onSelect={() => {
                if (!effectiveLocalFileId) return;
                if (inLocalList) removeLocalSave(effectiveLocalFileId);
                else addLocalSave(effectiveLocalFileId);
              }}
            >
              <Bookmark className={cn("size-4", inLocalList && "fill-current")} aria-hidden />
              {inLocalList ? "Saved" : "Save"}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={shareBusy} onSelect={() => void onCopyLink()}>
              <Link2 className="size-4" aria-hidden />
              Copy link
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openComments()}>
              <MessageCircle className="size-4" aria-hidden />
              <span className="flex-1">Comments</span>
              <span className={cn(countClass, "text-xs")}>{formatNumber(commentCount)}</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />
          <DropdownMenuGroup>{playlistSaveMenuCollapsible}</DropdownMenuGroup>
          {!isOwner && currentUserId ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onSelect={() => {
                    // notInterested() feeds feed_negative_signals, which the feed
                    // ranking actually reads; hideFromFeed keeps the prefs list +
                    // toast. Then drop the card from the current feed view.
                    if (fileId) void personalizationService.notInterested(fileId);
                    void hideFromFeed("file", uniqueId, {
                      successText: "Got it. We'll show less like this.",
                    });
                    setFiles?.((prev) =>
                      prev.filter((f) => f.id !== fileId && f.unique_id !== uniqueId),
                    );
                  }}
                >
                  <EyeOff className="size-4" aria-hidden />
                  Not interested
                </DropdownMenuItem>
                {fileOwnerId ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      void personalizationService.hideCreator(fileOwnerId);
                      void hideFromFeed("user", fileOwnerId, {
                        successText: "We won't recommend this creator.",
                      });
                      setFiles?.((prev) => prev.filter((f) => f.owner_id !== fileOwnerId));
                    }}
                  >
                    <UserMinus className="size-4" aria-hidden />
                    Don't recommend creator
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={() => setReportOpen(true)}>
                  <Flag className="size-4" aria-hidden />
                  Report
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
  );

  /** Same segmented like/dislike pill as the watch row; reel/tiktok stacks the two halves vertically. */
  const likeDislikeSegment = (
    <div
      className={cn(
        "inline-flex shrink-0 items-stretch overflow-hidden rounded-full border shadow-sm",
        isReel
          ? "flex-col divide-y divide-white/15 border-white/18 bg-black/45 backdrop-blur-md shadow-none"
          : "flex-row divide-x divide-border border-border bg-card/80",
      )}
      role="group"
      aria-label="Like and dislike"
    >
      <button
        type="button"
        className={cn(
          segmentBtn,
          isReel && "flex-col gap-1 py-2.5 text-white hover:bg-white/10",
          !isReel && liked && "bg-primary/15 text-primary hover:bg-primary/20",
          isReel && liked && "bg-primary/35 text-white hover:bg-primary/45",
        )}
        onClick={() => applyLikeDislike("like")}
        disabled={likeBusy}
        aria-pressed={liked}
        aria-label={liked ? "Unlike" : "Like"}
      >
        {likeBusy ? (
          <Loader2 className="h-[1.125rem] w-[1.125rem] shrink-0 animate-spin" aria-hidden />
        ) : (
          <ThumbsUp className={cn("h-[1.125rem] w-[1.125rem] shrink-0", liked && "fill-current")} aria-hidden />
        )}
        <span className={cn(isReel ? reelLabel : countClass, isReel && "text-[11px] leading-none")}>
          {formatNumber(likeCount)}
        </span>
      </button>
      <button
        type="button"
        className={cn(
          segmentBtn,
          isReel && "flex-col gap-1 py-2.5 text-white hover:bg-white/10",
          !isReel && disliked && "bg-destructive/10 text-destructive hover:bg-destructive/15",
          isReel && disliked && "bg-rose-500/30 text-white hover:bg-rose-500/40",
        )}
        onClick={() => applyLikeDislike("dislike")}
        disabled={dislikeBusy}
        aria-pressed={disliked}
        aria-label={disliked ? "Remove dislike" : "Dislike"}
      >
        {dislikeBusy ? (
          <Loader2 className="h-[1.125rem] w-[1.125rem] shrink-0 animate-spin" aria-hidden />
        ) : (
          <ThumbsDown className={cn("h-[1.125rem] w-[1.125rem] shrink-0", disliked && "fill-current")} aria-hidden />
        )}
        <span className={cn(isReel ? reelLabel : countClass, isReel && "text-[11px] leading-none")}>
          {formatNumber(dislikeCount)}
        </span>
      </button>
    </div>
  );

  const defaultRow = (
    <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {howLikesDislikeComments ? likeDislikeSegment : null}

      {howLikesDislikeComments && (
      <button type="button" className={pillOuter} onClick={openComments} aria-label="View comments">
        <MessageCircle className="h-[1.125rem] w-[1.125rem] shrink-0" aria-hidden />
        <span className={countClass}>{formatNumber(commentCount)}</span>
      </button>
      )}

      {shareSaveInRow ? (
        <>
          <button
            type="button"
            className={cn(pillOuter, "max-md:hidden")}
            onClick={openReelShare}
            disabled={shareBusy}
            aria-label="Share"
          >
            {shareBusy ? (
              <Loader2 className="h-[1.125rem] w-[1.125rem] shrink-0 animate-spin" aria-hidden />
            ) : (
              <Share2 className="h-[1.125rem] w-[1.125rem] shrink-0" aria-hidden />
            )}
            <span>Share</span>
          </button>
          {saveRowDropdown}
        </>
      ) : null}

      {moreDropdown}
    </div>
  );

  /** YouTube-Shorts-style rail: like + count, dislike, comment + count, share,
      more, and the sound art tile at the bottom. */
  const instagramReelRow = (
    <div className={cn("flex flex-col items-center", reelRowGapClass)}>
      {howLikesDislikeComments ? (
        <button
          type="button"
          className={cn(
            "group flex select-none flex-col items-center",
            reelDensityMinimal ? "gap-0.5" : "gap-1",
          )}
          onClick={() => {
            pulseLikeButton();
            applyLikeDislike("like");
          }}
          disabled={likeBusy}
          aria-pressed={liked}
          aria-label={liked ? "Unlike" : "Like"}
        >
          <span
            ref={reelLikeIconRef}
            data-reel-like-target=""
            className={cn(
              reelIconBtn,
              "group-active:scale-90",
              likeBusy && "opacity-70",
              likeButtonPop && "reel-like-target-pop",
            )}
          >
            {likeBusy ? (
              <Loader2 className={cn(reelIconSize, "shrink-0 animate-spin")} aria-hidden />
            ) : (
              <ThumbsUp
                key={liked ? "liked" : "unliked"}
                className={cn(
                  reelIconSize,
                  "shrink-0 transition-colors duration-150",
                  liked && "fill-current",
                  likeButtonPop && "action-like-pop",
                )}
                aria-hidden
              />
            )}
          </span>
          <span key={likeCount} className={cn(reelLabelClass, "action-count-pop")}>
            {formatNumber(likeCount)}
          </span>
        </button>
      ) : null}

      {howLikesDislikeComments ? (
        <button
          type="button"
          className={cn(
            "group flex select-none flex-col items-center",
            reelDensityMinimal ? "gap-0.5" : "gap-1",
          )}
          onClick={() => applyLikeDislike("dislike")}
          disabled={dislikeBusy}
          aria-pressed={disliked}
          aria-label={disliked ? "Remove dislike" : "Dislike"}
        >
          <span className={cn(reelIconBtn, "group-active:scale-90", dislikeBusy && "opacity-70")}>
            {dislikeBusy ? (
              <Loader2 className={cn(reelIconSize, "shrink-0 animate-spin")} aria-hidden />
            ) : (
              <ThumbsDown
                className={cn(reelIconSize, "shrink-0", disliked && "fill-current")}
                aria-hidden
              />
            )}
          </span>
          {reelAuxLabel("Dislike")}
        </button>
      ) : null}

      {howLikesDislikeComments ? (
        <button
          type="button"
          className={cn(
            "group flex select-none flex-col items-center",
            reelDensityMinimal ? "gap-0.5" : "gap-1",
          )}
          onClick={openComments}
          aria-label="View comments"
        >
          <span className={cn(reelIconBtn, "group-active:scale-90")}>
            <MessageCircle className={cn(reelIconSize, "shrink-0")} aria-hidden />
          </span>
          <span className={reelLabelClass}>{formatNumber(commentCount)}</span>
        </button>
      ) : null}

      <button
        type="button"
        className={cn(
          "group flex select-none flex-col items-center",
          reelDensityMinimal ? "gap-0.5" : "gap-1.5",
        )}
        onClick={openReelShare}
        disabled={shareBusy}
        aria-label="Share"
      >
        <span className={cn(reelIconBtn, "group-active:scale-90")}>
          {shareBusy ? (
            <Loader2 className={cn(reelIconSize, "shrink-0 animate-spin")} aria-hidden />
          ) : (
            <Share2 className={cn(reelIconSize, "shrink-0")} aria-hidden />
          )}
        </span>
        {reelAuxLabel("Share")}
      </button>

      {/* Remix is not built yet. The audio-art tile below still reaches the
          sound page, so pulling this only removes the promise of an action the
          app cannot perform. */}

      {moreDropdown}

      {reelAudioArt ? (
        // Interactive: the art links to the sound page (no aria-hidden).
        <div
          className={cn(
            "mt-0.5 shrink-0 overflow-hidden rounded-lg ring-1 ring-white/40 shadow-[0_2px_8px_rgba(0,0,0,0.6)]",
            reelDensityMinimal ? "h-7 w-7" : reelDensityCompact ? "h-8 w-8" : "h-9 w-9",
          )}
        >
          {reelAudioArt}
        </div>
      ) : null}
    </div>
  );

  const reelRow = (
    <div className="flex flex-col items-center gap-5">
      {howLikesDislikeComments ? likeDislikeSegment : null}

      {howLikesDislikeComments && (
      <button
        type="button"
        className={cn(
          isReel ? "flex flex-col items-center gap-1" : cn(pillOuter, "flex-col gap-1 py-2.5"),
        )}
        onClick={openComments}
        aria-label="View comments"
      >
        {isReel ? (
          <>
            <span className={reelIconBtn}>
              <MessageCircle className="h-[1.125rem] w-[1.125rem] shrink-0" aria-hidden />
            </span>
            <span className={reelLabelClass}>{formatNumber(commentCount)}</span>
          </>
        ) : (
          <>
            <MessageCircle className="h-[1.125rem] w-[1.125rem] shrink-0" aria-hidden />
            <span className={cn(countClass, "text-[11px] leading-none")}>{formatNumber(commentCount)}</span>
          </>
        )}
      </button>
      )}

      {moreDropdown}
    </div>
  );

  return (
    <>
      {isShortsShelf ? moreDropdown : isReel ? (instagramStyle ? instagramReelRow : reelRow) : defaultRow}

      {currentUserId ? (
        <CreatePlaylistModal
          open={createPlaylistOpen}
          onOpenChange={setCreatePlaylistOpen}
          onCreated={(pl) => {
            setPlaylists((prev) => [{ ...pl, item_count: 0 }, ...prev]);
          }}
        />
      ) : null}

      {suppressCommentsUi ? null : isMobile ? (
        /**
         * YouTube-style comments bottom sheet:
         *  - Full width, anchored flush to the bottom edge (no centered card insets).
         *  - Tall  up to 85dvh  leaving the video visible above so the user keeps watching.
         *  - Sits at the very top of the stacking order via the drawer primitive's max z-index;
         *    floating UI like the mini-player dock can no longer cover it.
         *  - Backdrop is lighter on mobile so the video peeking above stays readable.
         */
        <Drawer
          open={commentsPanelOpen}
          onOpenChange={setCommentsPanelOpen}
          direction="bottom"
        >
          <DrawerOverlay className="bg-black/30" />
          <DrawerContent
            id="watch-comments-drawer"
            className="flex flex-col gap-0 overflow-hidden p-0 pb-0 data-[vaul-drawer-direction=bottom]:inset-x-0 data-[vaul-drawer-direction=bottom]:mx-auto data-[vaul-drawer-direction=bottom]:h-[85dvh] data-[vaul-drawer-direction=bottom]:max-h-[85dvh] data-[vaul-drawer-direction=bottom]:w-full data-[vaul-drawer-direction=bottom]:max-w-2xl data-[vaul-drawer-direction=bottom]:rounded-t-2xl data-[vaul-drawer-direction=bottom]:border-t data-[vaul-drawer-direction=bottom]:border-border data-[vaul-drawer-direction=bottom]:pb-0 data-[vaul-drawer-direction=bottom]:shadow-[0_-12px_40px_-8px_rgba(0,0,0,0.35)]"
          >
            <DrawerHeader className="shrink-0 border-b px-3 py-2 text-left">
              <DrawerTitle className="text-base">Comments</DrawerTitle>
            </DrawerHeader>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {commentsPanelOpen ? (
                <CommentSection
                  key={`${fileId}-${highlightCommentId ?? ""}`}
                  fileId={fileId}
                  fileUniqueId={uniqueId}
                  fileCreatedAt={fileCreatedAt}
                  fileIsAdult={isAdult}
                  currentUserId={currentUserId ?? undefined}
                  fileOwnerId={fileOwnerId}
                  commentsEnabled={commentsEnabled}
                  highlightCommentId={highlightCommentId}
                  fillHeight
                  className="min-h-0 flex-1"
                  onCountDelta={onCommentCountDelta}
                />
              ) : null}
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={commentsPanelOpen} onOpenChange={setCommentsPanelOpen}>
          <DialogContent
            showCloseButton
            className="flex h-[min(90vh,720px)] w-[calc(100vw-1.5rem)] max-w-xl flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
          >
            <div className="flex min-h-0 flex-1 flex-col px-3 py-2">
              {commentsPanelOpen ? (
                <CommentSection
                  key={`${fileId}-${highlightCommentId ?? ""}`}
                  fileId={fileId}
                  fileUniqueId={uniqueId}
                  fileCreatedAt={fileCreatedAt}
                  fileIsAdult={isAdult}
                  currentUserId={currentUserId ?? undefined}
                  fileOwnerId={fileOwnerId}
                  commentsEnabled={commentsEnabled}
                  highlightCommentId={highlightCommentId}
                  fillHeight
                  className="min-h-0 flex-1"
                  onCountDelta={onCommentCountDelta}
                />
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      )}

      <ShareModal
        open={shareModalOpen}
        onOpenChange={setShareModalOpen}
        shareUrl={buildPageShareUrl(pagePathForShare, resolveShareSeconds())}
        currentTime={currentTime}
      />
      <ReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        targetType="file"
        targetId={uniqueId}
      />
    </>
  );
}
