import { Link } from "react-router";
import { ChevronRight, ListVideo } from "lucide-react";
import VideoCard from "~/routes/Home/components/VideoCard";
import { FEED_HIDE_ACTIONS } from "~/lib/feed/feedVideoCardLayout";
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
  profileOwnerUsername: string;
  isOwner: boolean;
  currentUserId?: string | null;
  userActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
}

/** Section with a responsive grid of cards (no horizontal overflow). */
function SectionRow({
  title,
  to,
  bodyClassName,
  children,
}: {
  title: string;
  to?: string;
  /** Grid column/gap classes for the body (appended after `grid w-full min-w-0`). */
  bodyClassName?: string;
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
      <div className={cn("grid w-full min-w-0", bodyClassName)}>{children}</div>
    </section>
  );
}

export default function ChannelHome({
  sections,
  buckets,
  profileOwnerUsername,
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
      <SectionRow
        key={type}
        title={SECTION_LABELS[type]}
        to={seeAllTo}
        bodyClassName={cn(
          "gap-x-3 gap-y-5 sm:gap-x-4",
          reel
            ? "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6"
            : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
        )}
      >
        {preview.map((file, i) => (
          <div key={file.id} className="min-w-0">
            <VideoCard
              data={file}
              index={i}
              layout={reel ? "reelStrip" : "default"}
              currentUserId={currentUserId ?? undefined}
              userActions={userActions}
              hideActions={FEED_HIDE_ACTIONS}
              profileOwnerUsername={reel ? profileOwnerUsername : undefined}
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
