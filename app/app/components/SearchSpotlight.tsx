import { Link } from "react-router";
import { Radio, User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import { mixWatchPath } from "~/lib/music/mixId";
import VideoCard from "~/routes/Home/components/VideoCard";
import type { FileType } from "~/lib/types";

/**
 * Entity spotlight at the top of search results.
 *
 * Mirrors what YouTube does: the layout is chosen by ENTITY TYPE, not by the
 * words in the query. A plain creator gets a channel row plus a "Latest from"
 * shelf; a MUSIC ARTIST gets the same header with music actions — the Mix
 * button being the important one, since a mix is the natural entry point into
 * an artist's catalogue.
 */

export interface SpotlightData {
  kind: "artist" | "creator";
  channel: { id: string; username: string; profile_pic: string; file_count: number };
  shelf: FileType[];
  mixGid: string | null;
  mixSeedUniqueId: string | null;
}

export default function SearchSpotlight({ spotlight }: { spotlight: SpotlightData | null }) {
  if (!spotlight?.channel?.username) return null;

  const { kind, channel, shelf, mixGid, mixSeedUniqueId } = spotlight;
  const isArtist = kind === "artist";
  const profileHref = `/profile/${encodeURIComponent(channel.username)}`;
  const items = Array.isArray(shelf) ? shelf.slice(0, 6) : [];

  return (
    <section
      className="mb-6 min-w-0 rounded-xl border border-border/60 bg-card/40 p-4 sm:p-5"
      aria-label={isArtist ? "Artist" : "Channel"}
    >
      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
        <Link to={profileHref} className="shrink-0">
          <Avatar className="h-16 w-16 sm:h-20 sm:w-20">
            <AvatarImage src={getProfilePicUrl(channel.profile_pic)} alt="" />
            <AvatarFallback>
              <User className="h-6 w-6 text-muted-foreground" />
            </AvatarFallback>
          </Avatar>
        </Link>

        <div className="min-w-0 flex-1">
          <Link to={profileHref} className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-foreground hover:underline sm:text-xl">
              {channel.username}
            </h2>
          </Link>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            @{channel.username}
            {channel.file_count > 0 && (
              <>
                <span className="px-1.5 text-muted-foreground/60">·</span>
                {channel.file_count} {channel.file_count === 1 ? "upload" : "uploads"}
              </>
            )}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/* Music actions only for artists — this is the whole reason the
              layout branches, exactly as YouTube's does. */}
          {isArtist && mixGid && mixSeedUniqueId && (
            <Link
              to={mixWatchPath(String(mixSeedUniqueId), mixGid, {
                startRadio: true,
                index: 1,
              })}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/70"
            >
              <Radio className="h-4 w-4" />
              Mix
            </Link>
          )}
          <Link
            to={profileHref}
            className="inline-flex items-center rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            View channel
          </Link>
        </div>
      </div>

      {items.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">
            {isArtist ? "Top tracks" : `Latest from ${channel.username}`}
          </h3>
          <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {items.map((file) => (
              <VideoCard key={file.id ?? file.unique_id} data={file} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
