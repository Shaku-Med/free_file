import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ChevronRight, Globe, ListVideo, Lock, Music } from "lucide-react";

interface PlaylistRow {
  id: string;
  title: string;
  description?: string | null;
  is_public: boolean;
  unique_id: string;
  item_count: number;
  first_thumb?: string | null;
  thumbnail_url?: string | null;
}

function SkeletonPlaylistCard() {
  return (
    <div className="animate-pulse flex items-center gap-3 p-3 rounded-xl bg-card border">
      <div className="w-12 h-12 rounded-lg bg-muted shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-4 bg-muted rounded w-[70%]" />
        <div className="h-3 bg-muted rounded w-[40%]" />
      </div>
    </div>
  );
}

interface ProfilePlaylistsSectionProps {
  profileUserId: string;
  isOwner: boolean;
  dataReady?: boolean;
}

const ProfilePlaylistsSection = ({
  profileUserId,
  isOwner,
  dataReady = true,
}: ProfilePlaylistsSectionProps) => {
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/profile-tab?userId=${encodeURIComponent(profileUserId)}&tab=playlists`,
          { credentials: "include" }
        );
        if (!response.ok || cancelled) return;
        const result = await response.json();
        if (cancelled) return;
        setPlaylists(Array.isArray(result.playlists) ? result.playlists : []);
      } catch (e) {
        console.error("ProfilePlaylistsSection:", e);
        if (!cancelled) setPlaylists([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileUserId]);

  return (
    <div className="space-y-6" data-data-ready={dataReady}>
      {!isOwner && (
        <p className="text-sm text-muted-foreground -mt-2">
          Only public playlists are visible to others.
        </p>
      )}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonPlaylistCard key={i} />
          ))}
        </div>
      ) : playlists.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {playlists.map((pl) => {
            const thumb = pl.thumbnail_url || pl.first_thumb;
            return (
              <Link
                key={pl.id}
                to={`/playlist/${pl.id}`}
                className="group flex items-center gap-3 p-3 rounded-xl bg-card hover:bg-accent/50 transition-colors border"
              >
                <div className="w-12 h-12 rounded-lg bg-primary/10 overflow-hidden shrink-0 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
                  {thumb ? (
                    <img src={thumb} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Music className="w-5 h-5 text-primary" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                    {pl.title}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    <span>
                      {pl.item_count} {pl.item_count === 1 ? "item" : "items"}
                    </span>
                    <span className="text-muted-foreground/50">·</span>
                    {pl.is_public ? (
                      <span className="inline-flex items-center gap-0.5">
                        <Globe className="w-3 h-3" /> Public
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5">
                        <Lock className="w-3 h-3" /> Private
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors shrink-0" />
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed p-6 text-center">
          <ListVideo className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No playlists to show</p>
        </div>
      )}
    </div>
  );
};

export default ProfilePlaylistsSection;
