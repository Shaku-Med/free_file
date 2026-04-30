import { useState, useEffect, useCallback } from "react";
import { Link, useParams, useNavigate, type MetaFunction } from "react-router";
import VideoCard from "~/routes/Home/components/VideoCard";
import type { FileType } from "~/lib/types";
import { useFileContext } from "~/lib/Context/Context";
import { Button } from "~/components/ui/button";
import {
  Trash2,
  Lock,
  Globe,
  ArrowLeft,
  Music,
  Pencil,
  Share2,
  MoreHorizontal,
} from "lucide-react";
import { buildPageMeta } from "~/lib/seo";
import { ShareModal } from "~/components/ShareModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useBodyVideoGridClassName } from "~/lib/Context/BodyContentWidthContext";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Playlist | Memories",
    description: "View a playlist on Memories.",
  });

function SkeletonCard() {
  return (
    <div className="animate-pulse">
      <div className="aspect-video bg-muted rounded-xl" />
      <div className="flex gap-3 mt-3">
        <div className="w-9 h-9 rounded-full bg-muted shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-muted rounded w-[85%]" />
          <div className="h-3 bg-muted rounded w-[60%]" />
        </div>
      </div>
    </div>
  );
}

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
  const bodyVideoGridClass = useBodyVideoGridClassName();
  const { playlistId } = useParams();
  const navigate = useNavigate();
  const { userId } = useFileContext();
  const [playlist, setPlaylist] = useState<PlaylistData | null>(null);
  const [items, setItems] = useState<FileType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
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
    setEditDesc(playlist.description || "");
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
          description: editDesc.trim() || null,
          is_public: editPublic,
        }),
      });
      if (res.ok) {
        setPlaylist(prev => prev ? {
          ...prev,
          title: editTitle.trim(),
          description: editDesc.trim() || undefined,
          is_public: editPublic,
        } : prev);
        setEditing(false);
      }
    } catch {}
    finally { setSaving(false); }
  }, [playlistId, editTitle, editDesc, editPublic]);

  const isOwner = playlist?.owner_id === userId;
  const shareUrl = typeof window !== "undefined" && playlist
    ? `${window.location.origin}/playlist/${playlist.id}`
    : "";

  if (loading) {
    return (
      <div className="space-y-6">
        {/* Skeleton header */}
        <div className="animate-pulse space-y-3">
          <div className="h-5 w-32 bg-muted rounded" />
          <div className="h-7 w-64 bg-muted rounded" />
          <div className="h-4 w-48 bg-muted rounded" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (error || !playlist) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4">
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
          <Music className="w-7 h-7 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-bold mb-1">{error || "Playlist not found"}</h1>
        <p className="text-sm text-muted-foreground mb-4">This playlist may have been deleted or is private.</p>
        <Link to="/playlist">
          <Button variant="outline" className="rounded-full gap-1.5">
            <ArrowLeft className="w-4 h-4" />
            Back to playlists
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link to="/playlist" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" />
        All playlists
      </Link>

      {/* Playlist header */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        {/* Playlist icon */}
        <div className="w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Music className="w-7 h-7 text-primary" />
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
              <textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                maxLength={500}
                rows={2}
                className="w-full text-sm bg-transparent border-b border-border focus:border-primary outline-none pb-1 resize-none text-muted-foreground"
                placeholder="Add a description..."
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
                <h1 className="text-xl font-bold truncate">{playlist.title}</h1>
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
              {playlist.description && (
                <p className="text-sm text-muted-foreground mt-1">{playlist.description}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1.5">
                {items.length} {items.length === 1 ? "item" : "items"}
                <span className="mx-1.5">·</span>
                {new Date(playlist.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
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

      {/* Video grid */}
      {items.length > 0 ? (
        <div className={bodyVideoGridClass}>
          {items.map((file, index) => (
            <VideoCard
              key={file.id || index}
              data={file}
              index={index}
              currentUserId={userId || undefined}
              userActions={{ likedFileIds: new Set(), dislikedFileIds: new Set() }}
              hideActions={{completely: true}}
            />
          ))}
        </div>
      ) : (
        <div className="flex items-center flex-col justify-center py-16 rounded-xl border border-dashed">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
            <Music className="w-7 h-7 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-1">This playlist is empty</h3>
          <p className="text-sm text-muted-foreground mb-5 text-center max-w-sm">
            Add videos from the options menu on any video
          </p>
          <Link to="/">
            <Button variant="default" className="rounded-full px-6">
              Browse content
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
