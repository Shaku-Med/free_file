import { memo, useState } from "react";
import { Link } from "react-router";
import { Heart } from "lucide-react";
import ImageLoad from "~/routes/Home/components/ImageLoad/ImageLoad";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { formatTimeAgo } from "~/lib/formatTimeAgo";
import { displayMediaTitle, getThumbnailUrl } from "~/lib/utils";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import type { FileType } from "~/lib/types";
import { tileAspect } from "./Masonry";

const HEX_RE = /^#[0-9a-f]{6}$/i;
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** The photo's main colour, to tint the tile while it loads. */
function dominantColor(colors: unknown): string | null {
  const first = Array.isArray(colors) ? colors[0] : null;
  return typeof first === "string" && HEX_RE.test(first) ? first : null;
}

function PostTile({
  post,
  index,
  aspect,
  onSize,
}: {
  post: FileType;
  index: number;
  aspect: number | undefined;
  onSize: (key: string, width: number, height: number) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const title = displayMediaTitle(post.file_title || post.filename || "");
  const owner = post.owner;
  const likes = Number(post.like_count) || 0;
  const tint = dominantColor(post.colors);
  const href = `/${post.unique_id}`;
  const ownerHref = owner ? `/profile/${encodeURIComponent(owner.username)}` : null;
  const label = `${title === "Untitled" ? "Post" : title}${owner ? ` by ${owner.username}` : ""}`;

  return (
    <article className="group/post min-w-0">
      <Link
        to={href}
        prefetch="intent"
        aria-label={label}
        className="relative block overflow-hidden rounded-xl bg-muted outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        style={{
          aspectRatio: String(tileAspect(aspect)),
          ...(tint ? { backgroundColor: `color-mix(in oklab, ${tint} 30%, var(--muted))` } : {}),
        }}
      >
        <ImageLoad
          key={attempt}
          link={getThumbnailUrl(post)}
          imageID={`post_${post.unique_id}`}
          index={index}
          retry={() => setAttempt((n) => Math.min(n + 1, 2))}
          quality={70}
          hasAdultTag={Boolean(post.is_adult)}
          className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover/post:scale-[1.03]"
          onNaturalSize={(w, h) => onSize(post.unique_id, w, h)}
        />
        {likes > 0 && (
          <span className="pointer-events-none absolute bottom-2 left-2 z-[3] flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-xs font-medium text-white opacity-0 backdrop-blur-sm transition-opacity duration-200 group-hover/post:opacity-100">
            <Heart className="h-3 w-3 fill-current" aria-hidden />
            {compact.format(likes)}
          </span>
        )}
      </Link>

      <div className="mt-2 flex min-w-0 items-start gap-2 px-0.5">
        {owner && ownerHref && (
          <Link to={ownerHref} prefetch="intent" className="mt-0.5 shrink-0" aria-label={owner.username}>
            <Avatar className="h-7 w-7">
              <AvatarImage src={getProfilePicUrl(owner.profile_pic)} alt="" className="object-cover" />
              <AvatarFallback className="text-[11px]">{owner.username.charAt(0).toUpperCase()}</AvatarFallback>
            </Avatar>
          </Link>
        )}
        <div className="min-w-0 flex-1">
          {title !== "Untitled" && (
            <Link
              to={href}
              prefetch="intent"
              tabIndex={-1}
              className="line-clamp-2 break-words text-sm font-medium leading-snug text-foreground"
            >
              {title}
            </Link>
          )}
          <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            {owner && ownerHref && (
              <Link to={ownerHref} prefetch="intent" tabIndex={-1} className="truncate transition-colors hover:text-foreground">
                {owner.username}
              </Link>
            )}
            {owner && post.created_at && <span aria-hidden>·</span>}
            {post.created_at && <span className="shrink-0">{formatTimeAgo(post.created_at)}</span>}
          </div>
        </div>
      </div>
    </article>
  );
}

export default memo(PostTile);
