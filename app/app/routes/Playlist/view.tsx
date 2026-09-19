import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useParams, useNavigate, type MetaFunction } from "react-router";
import VideoCard from "~/routes/Home/components/VideoCard";
import type { FileType } from "~/lib/types";
import { groupConsecutiveReelClusters } from "~/lib/feed/groupConsecutiveReelClusters";
import { MediaGridSkeleton, ReelShelf, VideoCardSkeleton } from "~/components/MediaShelf";
import { getThumbnailUrl } from "~/lib/utils";
import { MEDIA_GRID, FEED_HIDE_ACTIONS } from "~/lib/feed/feedVideoCardLayout";
import type { PlaylistCover } from "~/lib/playlist/playlistCovers.server";
import { useFileContext } from "~/lib/Context/Context";
import { Button } from "~/components/ui/button";
import {
  Trash2,
  Lock,
  Globe,
  Music,
  Pencil,
  Share2,
  MoreHorizontal,
} from "lucide-react";
import { buildPageMeta } from "~/lib/seo";
import { ShareModal } from "~/components/ShareModal";
import { SignInToSeeMore } from "~/components/SignInWall";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

const GUEST_MAX_VISIBLE_VIDEOS = 18;

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Playlist | Memories",
    description: "A playlist on Memories.",
  });

interface PlaylistData {
  id: string;
  title: string;
  description?: string;
  is_public: boolean;
  owner_id: string;
  unique_id: string;
  created_at: string;
}

export default function PlaylistViewPage() {
  const { playlistId } = useParams();
  const navigate = useNavigate();
  const { userId } = useFileContext();
  const [playlist, setPlaylist] = useState<PlaylistData | null>(null);
  const [items, setItems] = useState<FileType[]>([]);
  const [cover, setCover] = useState<PlaylistCover | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editPublic, setEditPublic] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchPlaylist = useCallback(async () => {
    if (!playlistId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/playlists/${playlistId}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Failed to load playlist");
        return;
      }
      setPlaylist(json.playlist);
      setItems(json.items || []);
      setCover(json.cover ?? null);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [playlistId]);

  useEffect(() => {
    fetchPlaylist();
  }, [fetchPlaylist]);

  const handleRemoveItem = useCallback(async (fileId: string) => {
    if (!playlistId) return;
    try {
      const res = await fetch(`/api/playlists/${playlistId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", file_id: fileId }),
      });
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.id !== fileId));
      }
    } catch {}
  }, [playlistId]);

  const handleDelete = useCallback(async () => {
    if (!playlistId || !confirm("Delete this playlist? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/playlists/${playlistId}`, { method: "DELETE" });
      if (res.ok) navigate("/playlist");
    } catch {}
  }, [playlistId, navigate]);

  const startEdit = useCallback(() => {
    if (!playlist) return;
    setEditTitle(playlist.title);
    setEditPublic(playlist.is_public);
    setEditing(true);
  }, [playlist]);

  const handleSave = useCallback(async () => {
    if (!playlistId || !editTitle.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/playlists/${playlistId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle.trim(),
          description: null,
          is_public: editPublic,
        }),
      });
      if (res.ok) {
        setPlaylist(prev => prev ? {
          ...prev,
          title: editTitle.trim(),
          is_public: editPublic,
        } : prev);
        setEditing(false);
      }
    } catch {}
    finally { setSaving(false); }
  }, [playlistId, editTitle, editPublic]);

  const isOwner = playlist?.owner_id === userId;
  const shareUrl = typeof window !== "undefined" && playlist
    ? `${window.location.origin}/playlist/${playlist.id}`
    : "";

  const handleFileUpdate = useCallback((fileId: string, updates: Partial<FileType>) => {
    setItems((prev) =>
      prev.map((file) => (file.id === fileId ? { ...file, ...updates } : file))
    );
  }, []);

  const { visibleItems, showGuestWall } = useMemo(() => {
    if (userId) return { visibleItems: items, showGuestWall: false };
    if (items.length <= GUEST_MAX_VISIBLE_VIDEOS) {
      return { visibleItems: items, showGuestWall: false };
    }
    return {
      visibleItems: items.slice(0, GUEST_MAX_VISIBLE_VIDEOS),
      showGuestWall: true,
    };
  }, [items, userId]);

  if (loading) {
    return (
      <div className="space-y-6">
        {/* Skeleton header */}
        <div className="animate-pulse space-y-3">
          <div className="h-5 w-32 bg-muted rounded" />
          <div className="h-7 w-64 bg-muted rounded" />
          <div className="h-4 w-48 bg-muted rounded" />
        </div>
        <MediaGridSkeleton count={8} className={MEDIA_GRID} />
      </div>
    );
  }

  if (error || !playlist) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4">
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
          <Music className="w-7 h-7 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-bold mb-1">{error || "Could not open this playlist"}</h1>
        <p className="text-sm text-muted-foreground mb-4">
          It may be private or no longer available.
        </p>
        <Button asChild variant="outline" className="rounded-full">
          <Link to="/">Home</Link>
        </Button>
      </div>
    );
  }

  const backdrop = cover
    ? getThumbnailUrl({
        default_thumbnail: cover.default_thumbnail,
        thumbnails: cover.thumbnails,
        file_type: cover.file_type,
        endpoint: cover.endpoint ?? undefined,
        created_at: cover.created_at ?? "",
        unique_id: cover.unique_id,
        filename: "",
      })
    : null;

  return (
    <div className="space-y-6">
      <div className="app_bleed relative overflow-hidden border-b border-border/50">
        {/* The cover blown up and blurred behind its own artwork, fading into
            the page. No sampled colours needed, and it works on any theme. */}
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          {backdrop ? (
            <img
              src={backdrop}
              alt=""
              className="h-full w-full scale-125 object-cover opacity-70 blur-2xl"
            />
          ) : (
            <div className="h-full w-full bg-muted" />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-background/45 via-background/80 to-background" />
        </div>

        <div className="relative flex flex-col gap-5 py-6 sm:flex-row sm:items-end sm:gap-6 sm:py-8">
        <div className="relative w-full shrink-0 overflow-hidden rounded-xl bg-muted shadow-xl shadow-black/25 sm:w-72">
          <div className="aspect-video">
            {cover ? (
              <VideoCard layout="notificationThumb" data={cover as unknown as FileType} />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Music className="h-7 w-7 text-muted-foreground/60" aria-hidden />
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="space-y-3">
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                maxLength={100}
                className="w-full text-xl font-bold bg-transparent border-b border-border focus:border-primary outline-none pb-1"
                placeholder="Playlist title"
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setEditPublic(true)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${editPublic ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent'}`}
                >
                  <Globe className="w-3 h-3" /> Public
                </button>
                <button
                  type="button"
                  onClick={() => setEditPublic(false)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${!editPublic ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-accent'}`}
                >
                  <Lock className="w-3 h-3" /> Private
                </button>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button size="sm" onClick={handleSave} disabled={saving || !editTitle.trim()}>
                  {saving ? "Saving..." : "Save"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">{playlist.title}</h1>
                {playlist.is_public ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    <Globe className="w-3 h-3" /> Public
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    <Lock className="w-3 h-3" /> Private
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                {items.length === 0
                  ? "No videos"
                  : items.length === 1
                    ? "1 video"
                    : `${items.length} videos`}
                {" · "}
                Added {new Date(playlist.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </p>
            </>
          )}
        </div>

        {/* Actions */}
        {!editing && (
          <div className="flex items-center gap-2 shrink-0">
            {playlist.is_public && (
              <Button variant="outline" size="sm" className="rounded-full gap-1.5" onClick={() => setShareOpen(true)}>
                <Share2 className="w-4 h-4" />
                Share
              </Button>
            )}
            {isOwner && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="rounded-full h-9 w-9">
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={startEdit}>
                    <Pencil className="w-4 h-4" />
                    Edit playlist
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDelete} className="text-destructive focus:text-destructive">
                    <Trash2 className="w-4 h-4" />
                    Delete playlist
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
        </div>
      </div>

      {/* Video grid (reel strips match Home / Profile) */}
      {items.length > 0 ? (
        <>
        <div className={MEDIA_GRID}>
          {(() => {
            const groups = groupConsecutiveReelClusters(visibleItems);
            let indexCounter = 0;
            return groups.map((g) => {
              if (g.kind === "single") {
                const file = g.file;
                const index = indexCounter++;
                return (
                  <VideoCard
                    key={file.id || file.unique_id || index}
                    data={file}
                    index={index}
                    currentUserId={userId || undefined}
                    userActions={{ likedFileIds: new Set(), dislikedFileIds: new Set() }}
                    onUpdate={handleFileUpdate}
                    hideActions={{ completely: true }}
                  />
                );
              }
              const clusterKey =
                g.files[0]?.feed_reel_cluster_id ?? g.files[0]?.id ?? "playlist";
              const startIndex = indexCounter;
              indexCounter += g.files.length;
              return (
                <ReelShelf
                  key={`playlist-reel-${clusterKey}`}
                  files={g.files}
                  startIndex={startIndex}
                  currentUserId={userId || undefined}
                  onUpdate={handleFileUpdate}
                  hideActions={FEED_HIDE_ACTIONS}
                />
              );
            });
          })()}
        </div>
        {showGuestWall && <SignInToSeeMore />}
        </>
      ) : (
        <div className="flex items-center flex-col justify-center py-16 rounded-xl border border-dashed">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
            <Music className="w-7 h-7 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-1">Nothing here yet</h3>
          <p className="text-sm text-muted-foreground mb-5 text-center max-w-sm">
            Open the menu on any clip and add it to this list.
          </p>
          <Link to="/">
            <Button variant="default" className="rounded-full px-6">
              Browse
            </Button>
          </Link>
        </div>
      )}

      {shareUrl && (
        <ShareModal
          open={shareOpen}
          onOpenChange={setShareOpen}
          shareUrl={shareUrl}
        />
      )}
    </div>
  );
}
