import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ChevronRight, ListVideo, Globe, Lock, Music } from "lucide-react";
import VideoCard from "~/routes/Home/components/VideoCard";
import { cn } from "~/lib/utils";
import type { FileType } from "~/lib/types";
import {
  CHANNEL_HOME_PREVIEW_LIMIT,
  SECTION_LABELS,
  type ChannelSection,
  type ChannelSectionType,
} from "~/lib/channel/channelLayout";

export interface ChannelHomeBuckets {
  shorts: FileType[];
  videos: FileType[];
  popular: FileType[];
}

interface ChannelHomeProps {
  sections: ChannelSection[];
  buckets: ChannelHomeBuckets;
  profileUserId: string;
  isOwner: boolean;
  currentUserId?: string | null;
  userActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
}

/** Horizontal scroll row of cards. */
function SectionRow({
  title,
  to,
  children,
}: {
  title: string;
  to?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">{title}</h2>
        {to && (
          <Link
            to={to}
            className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            See all <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
      <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:thin] sm:gap-4 md:gap-5">
        {children}
      </div>
    </section>
  );
}

function PlaylistsRow({ profileUserId, isOwner }: { profileUserId: string; isOwner: boolean }) {
  const [playlists, setPlaylists] = useState<
    { id: string; title: string; item_count: number; is_public: boolean }[]
  >([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/profile-tab?userId=${encodeURIComponent(profileUserId)}&tab=playlists`,
          { credentials: "include" },
        );
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (!cancelled) setPlaylists(Array.isArray(json.playlists) ? json.playlists : []);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileUserId]);

  if (loaded && playlists.length === 0) return null;

  return (
    <SectionRow title={SECTION_LABELS.playlists}>
      {playlists.map((pl) => (
        <Link
          key={pl.id}
          to={`/playlist/${pl.id}`}
          className="group flex w-60 shrink-0 snap-start items-center gap-3 rounded-xl border border-border/60 bg-card/40 p-3 transition-colors hover:bg-accent/50"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Music className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground group-hover:text-primary">
              {pl.title}
            </p>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>{pl.item_count === 1 ? "1 video" : `${pl.item_count} videos`}</span>
              <span className="text-muted-foreground/50">·</span>
              {pl.is_public ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
            </div>
          </div>
        </Link>
      ))}
    </SectionRow>
  );
}

export default function ChannelHome({
  sections,
  buckets,
  profileUserId,
  isOwner,
  currentUserId,
  userActions,
}: ChannelHomeProps) {
  const renderFileRow = (type: ChannelSectionType, files: FileType[], reel: boolean) => {
    if (files.length === 0) return null;
    const preview = files.slice(0, CHANNEL_HOME_PREVIEW_LIMIT);
    const seeAllTo =
      files.length >= CHANNEL_HOME_PREVIEW_LIMIT ? (`?view=${type}` as const) : undefined;
    return (
      <SectionRow key={type} title={SECTION_LABELS[type]} to={seeAllTo}>
        {preview.map((file, i) => (
          <div
            key={file.id}
            className={cn(
              "shrink-0 snap-start",
              reel
                ? "w-[46vw] max-w-[11.5rem] sm:w-44 md:w-48 lg:w-52"
                : "w-[78vw] max-w-[18rem] sm:w-64 sm:max-w-none md:w-72",
            )}
          >
            <VideoCard
              data={file}
              index={i}
              related
              layout={reel ? "reelStrip" : "shelf"}
              currentUserId={currentUserId ?? undefined}
              userActions={userActions}
              hideActions={{ completely: true }}
            />
          </div>
        ))}
      </SectionRow>
    );
  };

  const anyContent =
    buckets.shorts.length > 0 || buckets.videos.length > 0 || buckets.popular.length > 0;

  return (
    <div className="space-y-8 sm:space-y-10">
      {sections.map((section) => {
        if (!section.visible) return null;
        switch (section.type) {
          case "shorts":
            return renderFileRow("shorts", buckets.shorts, true);
          case "videos":
            return renderFileRow("videos", buckets.videos, false);
          case "popular":
            return renderFileRow("popular", buckets.popular, false);
          case "playlists":
            return <PlaylistsRow key="playlists" profileUserId={profileUserId} isOwner={isOwner} />;
          default:
            return null;
        }
      })}

      {!anyContent && (
        <div className="rounded-2xl border border-dashed border-border/60 py-12 text-center">
          <ListVideo className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {isOwner ? "Upload videos to fill out your profile." : "Nothing here yet."}
          </p>
        </div>
      )}
    </div>
  );
}
