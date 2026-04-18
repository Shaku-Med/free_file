import { useCallback, useEffect, useState } from "react";
import { isMobile } from "react-device-detect";
import { Link, useNavigate, useParams } from "react-router";
import {
  ThumbsUp,
  ThumbsDown,
  MessageCircle,
  Share2,
  Link2,
  Loader2,
  MoreHorizontal,
  ListPlus,
  Check,
  ListVideo,
  Plus,
  Pencil,
  Bookmark,
} from "lucide-react";
import { formatNumber } from "~/lib/utils/formatNumber";
import { ShareModal } from "~/components/ShareModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";
import CreatePlaylistModal from "~/components/Playlist/CreatePlaylistModal";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "~/components/ui/drawer";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import CommentSection from "~/routes/Dynamic/components/Comments/CommentSection";
import { useLocalPlaylist, normalizeLocalPlaylistFileId } from "~/lib/hooks/useLocalPlaylist";
import { useFileContext } from "~/lib/Context/Context";

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

function buildPageShareUrl(uniqueId: string, seconds?: number) {
  if (typeof window === "undefined") return "";
  const base = `${window.location.origin}/${encodeURIComponent(uniqueId)}`;
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
  onUpdate,
  getShareTimestamp,
  onShareSuccess,
  currentUserId,
  currentTime,
  fileCreatedAt,
  fileOwnerId,
  commentsEnabled = true,
  highlightCommentId = null,
  commentsOpen: commentsOpenProp,
  onCommentsOpenChange,
}: ActionsProps) {
  const navigate = useNavigate();
  const [likeBusy, setLikeBusy] = useState(false);
  const [dislikeBusy, setDislikeBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [canWebShare, setCanWebShare] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);

  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
  const [addedTo, setAddedTo] = useState<Set<string>>(() => new Set());
  const [playlistLoad, setPlaylistLoad] = useState<"idle" | "loading" | "error" | "done">("idle");
  const [playlistError, setPlaylistError] = useState("");
  const [addingPlaylistId, setAddingPlaylistId] = useState<string | null>(null);
  const [createPlaylistOpen, setCreatePlaylistOpen] = useState(false);
  const [internalCommentsOpen, setInternalCommentsOpen] = useState(false);
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
  const isOnThisFilePage = Boolean(routeDynamicId && routeDynamicId === uniqueId);
  const { has: hasLocalSave, add: addLocalSave, remove: removeLocalSave } = useLocalPlaylist();
  const effectiveLocalFileId = normalizeLocalPlaylistFileId(fileId);
  const inLocalList = Boolean(effectiveLocalFileId && hasLocalSave(effectiveLocalFileId));


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

  const applyLikeDislike = useCallback(
    async (kind: "like" | "dislike") => {
      if (!onUpdate) {
        requireAuth();
        return;
      }
      const setBusy = kind === "like" ? setLikeBusy : setDislikeBusy;
      setBusy(true);
      const url = kind === "like" ? "/api/likes" : "/api/dislikes";
      const { ok, json, status } = await postInteraction(url, { fileId });
      setBusy(false);
      if (status === 401) {
        requireAuth();
        return;
      }
      const norm = normalizeInteraction(json);
      if (ok && norm) {
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
    [fileId, onUpdate, requireAuth],
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
    const url = buildPageShareUrl(uniqueId, resolveShareSeconds());
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
  }, [uniqueId, resolveShareSeconds, recordShare]);

  const onCopyLink = useCallback(async () => {
    const url = buildPageShareUrl(uniqueId, resolveShareSeconds());
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
  }, [uniqueId, resolveShareSeconds, recordShare]);

  const openComments = useCallback(() => {
    if (isOnThisFilePage && !isMobile) {
      const el = document.getElementById("comments");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
    setCommentsPanelOpen(true);
  }, [isOnThisFilePage, setCommentsPanelOpen]);

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
    "inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-card/80 px-3 py-2 text-sm font-medium text-foreground shadow-sm transition hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 data-[state=open]:bg-accent/70";

  const moreTriggerClass =
    "inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-card/80 text-foreground shadow-sm transition hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 data-[state=open]:bg-accent/70";

  const countClass = "tabular-nums text-muted-foreground";

  const segmentBtn =
    "inline-flex flex-1 min-w-0 items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium transition hover:bg-accent/50 focus-visible:outline-none focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        className="inline-flex items-stretch divide-x divide-border overflow-hidden rounded-full border border-border bg-card/80 shadow-sm"
        role="group"
        aria-label="Like and dislike"
      >
        <button
          type="button"
          className={cn(
            segmentBtn,
            liked && "bg-primary/15 text-primary hover:bg-primary/20",
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
          <span className={countClass}>{formatNumber(likeCount)}</span>
        </button>
        <button
          type="button"
          className={cn(
            segmentBtn,
            disliked && "bg-destructive/10 text-destructive hover:bg-destructive/15",
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
          <span className={countClass}>{formatNumber(dislikeCount)}</span>
        </button>
      </div>

      <button type="button" className={pillOuter} onClick={openComments} aria-label="View comments">
        <MessageCircle className="h-[1.125rem] w-[1.125rem] shrink-0" aria-hidden />
        <span className={countClass}>{formatNumber(commentCount)}</span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={moreTriggerClass} aria-label="More options">
            <MoreHorizontal className="size-[1.125rem] shrink-0" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[12rem]">
          {isOwner && typeof onEdit === "function" ? (
            <>
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => onEdit()}>
                  <Pencil className="size-4" aria-hidden />
                  Edit upload
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => setShareModalOpen(true)}>
              <Share2 className="size-4" aria-hidden />
              Share
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
          <DropdownMenuGroup>
            <DropdownMenuSub onOpenChange={onPlaylistSubOpenChange}>
              <DropdownMenuSubTrigger>
                <ListPlus className="size-4" aria-hidden />
                Add to playlist
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-[13.5rem] p-0">
                <div className="max-h-[min(280px,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto overscroll-contain p-1.5">
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
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {currentUserId ? (
        <CreatePlaylistModal
          open={createPlaylistOpen}
          onOpenChange={setCreatePlaylistOpen}
          onCreated={(pl) => {
            setPlaylists((prev) => [{ ...pl, item_count: 0 }, ...prev]);
          }}
        />
      ) : null}

      {isMobile ? (
        <Drawer open={commentsPanelOpen} onOpenChange={setCommentsPanelOpen} direction="bottom">
          <DrawerContent
            id="watch-comments-drawer"
            className="flex flex-col gap-0 overflow-hidden p-0 data-[vaul-drawer-direction=bottom]:inset-x-auto data-[vaul-drawer-direction=bottom]:left-1/2 data-[vaul-drawer-direction=bottom]:right-auto data-[vaul-drawer-direction=bottom]:max-h-[min(85dvh,640px)] data-[vaul-drawer-direction=bottom]:w-[calc(100%-12px)] data-[vaul-drawer-direction=bottom]:max-w-xl data-[vaul-drawer-direction=bottom]:-translate-x-1/2 data-[vaul-drawer-direction=bottom]:rounded-t-2xl data-[vaul-drawer-direction=bottom]:border-x data-[vaul-drawer-direction=bottom]:border-t data-[vaul-drawer-direction=bottom]:border-border data-[vaul-drawer-direction=bottom]:shadow-[0_-12px_40px_-8px_rgba(0,0,0,0.25)] sm:data-[vaul-drawer-direction=bottom]:max-w-2xl"
          >
            <DrawerHeader className="shrink-0 border-b px-3 py-2 text-left">
              <DrawerTitle className="text-base">Comments</DrawerTitle>
            </DrawerHeader>
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-2 [scrollbar-gutter:stable]">
              {commentsPanelOpen ? (
                <CommentSection
                  key={`${fileId}-${highlightCommentId ?? ""}`}
                  fileId={fileId}
                  currentUserId={currentUserId ?? undefined}
                  fileOwnerId={fileOwnerId}
                  commentsEnabled={commentsEnabled}
                  highlightCommentId={highlightCommentId}
                  className="min-h-0"
                />
              ) : null}
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={commentsPanelOpen} onOpenChange={setCommentsPanelOpen}>
          <DialogContent
            showCloseButton
            className="flex w-[calc(100vw-1.5rem)] max-w-xl flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
          >
            <div className="max-h-[min(90vh,720px)] min-h-0 w-full overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-2 [scrollbar-gutter:stable]">
              {commentsPanelOpen ? (
                <CommentSection
                  key={`${fileId}-${highlightCommentId ?? ""}`}
                  fileId={fileId}
                  currentUserId={currentUserId ?? undefined}
                  fileOwnerId={fileOwnerId}
                  commentsEnabled={commentsEnabled}
                  highlightCommentId={highlightCommentId}
                  className="min-h-0"
                />
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      )}

      <ShareModal
        open={shareModalOpen}
        onOpenChange={setShareModalOpen}
        shareUrl={buildPageShareUrl(uniqueId, resolveShareSeconds())}
        currentTime={currentTime}
      />
    </div>
  );
}
