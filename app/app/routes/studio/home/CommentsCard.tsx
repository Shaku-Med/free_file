import { Link } from "react-router";
import { formatTimeAgo } from "~/lib/formatTimeAgo";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { useStudioData } from "~/lib/studio/studioCache";
import { DashCard, Skeleton, studioButton } from "../components/StudioUI";
import { postTitle } from "./PostThumb";

interface CommentAuthor {
  username: string;
  profile_pic: string | null;
}

interface RecentComment {
  id: string;
  comment: string;
  created_at: string;
  users: CommentAuthor | CommentAuthor[] | null;
  file: { unique_id: string; filename: string; file_title?: string | null } | null;
}

interface CommentsApi {
  success: boolean;
  data: RecentComment[];
}

function authorOf(row: RecentComment): CommentAuthor | null {
  if (!row.users) return null;
  return Array.isArray(row.users) ? row.users[0] ?? null : row.users;
}

export function CommentsCard() {
  const { data, loading } = useStudioData<CommentsApi>({
    cacheKey: "studio:comments:recent",
    url: "/api/studio/comments?limit=4&offset=0",
    ttlMs: 60_000,
  });
  const rows = data?.success ? data.data ?? [] : [];

  return (
    <DashCard
      title="Latest comments"
      subtitle="Across all your posts"
      footer={
        <Link to="/brozystudio/comments" className={studioButton}>
          View more
        </Link>
      }
    >
      {loading && rows.length === 0 ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3.5 w-4/5" />
              </div>
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet. They will land here first.</p>
      ) : (
        <ul className="-my-1 divide-y divide-border/50">
          {rows.map((row) => {
            const author = authorOf(row);
            return (
              <li key={row.id} className="flex gap-3 py-3 first:pt-1 last:pb-1">
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarImage src={getProfilePicUrl(author?.profile_pic ?? undefined)} alt="" />
                  <AvatarFallback className="bg-muted text-xs text-muted-foreground">
                    {(author?.username ?? "?").charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 text-xs">
                    <span className="truncate font-medium text-foreground">
                      {author?.username ?? "User"}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {formatTimeAgo(row.created_at)}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-sm leading-snug text-foreground">
                    {row.comment}
                  </p>
                  {row.file && (
                    <Link
                      to={`/${encodeURIComponent(row.file.unique_id)}`}
                      className="mt-1 block truncate text-xs text-muted-foreground hover:text-foreground"
                    >
                      on {postTitle({ file_title: row.file.file_title ?? null, filename: row.file.filename })}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </DashCard>
  );
}
