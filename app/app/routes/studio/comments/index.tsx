import { useState } from "react";
import { Link } from "react-router";
import type { MetaFunction } from "react-router";
import { buildPageMeta } from "~/lib/seo";
import { formatTimeAgo } from "~/lib/formatTimeAgo";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { FormattedText } from "~/components/FormattedText";
import { Loader2 } from "lucide-react";
import { useStudioData } from "~/lib/studio/studioCache";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Studio Comments | Memories",
    description: "Review and reply to comments on your posts.",
    canonicalPath: "/brozystudio/comments",
  });

interface AuthorRow {
  id: string;
  username: string;
  profile_pic: string | null;
  verified: boolean | null;
}

interface CommentRow {
  id: string;
  file_id: string;
  comment: string;
  created_at: string;
  updated_at: string | null;
  parent_id: string | null;
  user_id: string;
  users: AuthorRow | AuthorRow[] | null;
  file: {
    id: string;
    unique_id: string;
    filename: string;
    file_title?: string | null;
  } | null;
}

const PAGE_SIZE = 20;

function authorOf(row: CommentRow): AuthorRow | null {
  if (!row.users) return null;
  return Array.isArray(row.users) ? row.users[0] ?? null : row.users;
}

interface CommentsApi {
  success: boolean;
  data: CommentRow[];
  pagination: { total: number; hasMore: boolean };
}

export default function StudioCommentsPage() {
  const [offset, setOffset] = useState(0);
  const { data: raw, loading, error: err } = useStudioData<CommentsApi>({
    cacheKey: `studio:comments:${offset}`,
    url: `/api/studio/comments?limit=${PAGE_SIZE}&offset=${offset}`,
    ttlMs: 60_000,
  });
  const rows = raw?.data ?? [];
  const total = raw?.pagination?.total ?? 0;
  const hasMore = Boolean(raw?.pagination?.hasMore);

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold text-foreground">
          Comments <span className="text-muted-foreground">{total}</span>
        </h1>
      </header>

      {err && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Could not load comments. Try refreshing.
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 px-4 py-12 text-center text-sm text-muted-foreground">
          No comments yet on your posts.
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((c) => {
            const author = authorOf(c);
            const fileTitle =
              c.file?.file_title?.trim() ||
              c.file?.filename ||
              "Untitled post";
            return (
              <li
                key={c.id}
                className="rounded-lg border border-border/60 bg-card/40 p-3"
              >
                <div className="flex items-start gap-3">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage
                      src={getProfilePicUrl(author?.profile_pic ?? undefined)}
                      alt={author?.username ?? ""}
                    />
                    <AvatarFallback className="bg-primary/10 text-xs text-primary">
                      {(author?.username ?? "?").charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                      <span className="font-medium text-foreground">
                        {author?.username ?? "User"}
                      </span>
                      <span className="text-muted-foreground">
                        {formatTimeAgo(c.created_at)}
                      </span>
                      {c.parent_id && (
                        <span className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          reply
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-sm leading-relaxed text-foreground [&_a]:break-words">
                      {c.comment ? (
                        <FormattedText
                          text={c.comment}
                          mentionLinkClassName="!text-sky-600 hover:!text-sky-500 dark:!text-[#3ea6ff] dark:hover:!text-sky-300"
                          timestamps={
                            c.file?.unique_id ? { fileId: c.file.unique_id } : undefined
                          }
                        />
                      ) : null}
                    </div>
                    {c.file && (
                      <Link
                        to={`/${c.file.unique_id}`}
                        className="mt-2 inline-block max-w-full truncate text-xs text-muted-foreground hover:text-primary"
                      >
                        on {fileTitle}
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!loading && total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-2 pt-2 text-xs text-muted-foreground">
          <span>Showing {offset + 1} to {Math.min(offset + PAGE_SIZE, total)} of {total}</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              disabled={offset === 0}
              className="rounded-md border border-border/60 px-2.5 py-1 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              disabled={!hasMore}
              className="rounded-md border border-border/60 px-2.5 py-1 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
