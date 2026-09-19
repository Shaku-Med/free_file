import { Link } from "react-router";
import type { MetaFunction } from "react-router";
import { Film, Inbox, MessageSquare } from "lucide-react";
import { buildPageMeta } from "~/lib/seo";
import { formatNumber } from "~/lib/utils/formatNumber";
import { formatTimeAgo } from "~/lib/formatTimeAgo";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { useStudioData } from "~/lib/studio/studioCache";
import { useFileContext } from "~/lib/Context/Context";
import VideoCard from "~/routes/Home/components/VideoCard";
import type { FileType } from "~/lib/types";
import {
  EmptyState,
  ErrorNote,
  PageBody,
  PageHeader,
  Panel,
  Skeleton,
  StatTile,
} from "../components/StudioUI";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Studio Home | Memories",
    description: "Brozy Studio home: at a glance creator workspace.",
    canonicalPath: "/brozystudio",
  });

interface OverviewResponse {
  success: boolean;
  totals: {
    posts: number;
    views: number;
    likes: number;
    comments: number;
    subscribers: number;
  };
  last28d: { views: number; watchHours: number };
}

interface RecentPost {
  id: string;
  unique_id: string;
  filename: string;
  file_title?: string | null;
  file_type: string;
  endpoint: string;
  duration?: number | null;
  created_at: string;
  view_count?: number | null;
  like_count?: number | null;
  comment_count?: number | null;
  default_thumbnail?: string | null;
  thumbnails?: string[] | null;
}

interface PostsApi {
  success: boolean;
  data: RecentPost[];
}

interface CommentAuthor {
  id: string;
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

export default function StudioHomePage() {
  const { userId } = useFileContext();

  const { data: overview, loading: loadingOverview, error: overviewError } =
    useStudioData<OverviewResponse>({
      cacheKey: "studio:overview",
      url: "/api/studio/overview",
      ttlMs: 60_000,
    });

  const { data: postsRaw, loading: loadingPosts } = useStudioData<PostsApi>({
    cacheKey: "studio:posts:recent",
    url: "/api/studio/posts?limit=4&offset=0&sort=newest",
    ttlMs: 60_000,
  });

  const { data: commentsRaw, loading: loadingComments } = useStudioData<CommentsApi>({
    cacheKey: "studio:comments:recent",
    url: "/api/studio/comments?limit=4&offset=0",
    ttlMs: 60_000,
  });

  const totals = overview?.success ? overview.totals : null;
  const last28d = overview?.success ? overview.last28d : null;
  const recentPosts = postsRaw?.success ? postsRaw.data ?? [] : [];
  const recentComments = commentsRaw?.success ? commentsRaw.data ?? [] : [];

  const num = (v: number | undefined) => (v === undefined ? "—" : formatNumber(v));

  return (
    <PageBody>
      <PageHeader title="Studio" />

      {overviewError && <ErrorNote>Could not load your stats. Try refreshing.</ErrorNote>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Views (28d)"
          value={num(last28d?.views)}
          loading={loadingOverview}
          hint={totals ? `${formatNumber(totals.views)} all time` : undefined}
        />
        <StatTile
          label="Watch hours (28d)"
          value={last28d ? last28d.watchHours.toFixed(1) : "—"}
          loading={loadingOverview}
        />
        <StatTile
          label="Subscribers"
          value={num(totals?.subscribers)}
          loading={loadingOverview}
        />
        <StatTile
          label="Posts"
          value={num(totals?.posts)}
          loading={loadingOverview}
          hint={totals ? `${formatNumber(totals.likes)} likes` : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel
          title="Latest posts"
          icon={<Film className="h-4 w-4 text-muted-foreground" aria-hidden />}
          action={
            <Link to="/brozystudio/posts" className="text-xs font-medium text-primary hover:underline">
              See all
            </Link>
          }
          bodyClassName="p-3 sm:p-3"
        >
          {loadingPosts ? (
            <div className="space-y-3 p-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-12 w-20 rounded-md" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-3/5" />
                    <Skeleton className="h-3 w-2/5" />
                  </div>
                </div>
              ))}
            </div>
          ) : recentPosts.length === 0 ? (
            <EmptyState
              variant="panel"
              icon={Film}
              title="Nothing published yet"
            />
          ) : (
            <ul className="divide-y divide-border/50">
              {recentPosts.map((post) => (
                <li key={post.id} className="px-1 py-2 first:pt-1 last:pb-1">
                  <VideoCard
                    layout="studioRow"
                    data={{ ...post, owner_id: userId ?? undefined } as unknown as FileType}
                    currentUserId={userId ?? undefined}
                  />
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-1 text-xs tabular-nums text-muted-foreground">
                    <span>
                      <span className="font-medium text-foreground">
                        {formatNumber(post.view_count ?? 0)}
                      </span>{" "}
                      views
                    </span>
                    <span>
                      <span className="font-medium text-foreground">
                        {formatNumber(post.like_count ?? 0)}
                      </span>{" "}
                      likes
                    </span>
                    <span>
                      <span className="font-medium text-foreground">
                        {formatNumber(post.comment_count ?? 0)}
                      </span>{" "}
                      comments
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Latest comments"
          icon={<MessageSquare className="h-4 w-4 text-muted-foreground" aria-hidden />}
          action={
            <Link
              to="/brozystudio/comments"
              className="text-xs font-medium text-primary hover:underline"
            >
              See all
            </Link>
          }
          bodyClassName="p-3 sm:p-3"
        >
          {loadingComments ? (
            <div className="space-y-3 p-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-3.5 w-4/5" />
                  </div>
                </div>
              ))}
            </div>
          ) : recentComments.length === 0 ? (
            <EmptyState
              variant="panel"
              icon={Inbox}
              title="No comments yet"
            />
          ) : (
            <ul className="divide-y divide-border/50">
              {recentComments.map((row) => {
                const author = authorOf(row);
                const title =
                  row.file?.file_title?.trim() || row.file?.filename || "Untitled post";
                return (
                  <li key={row.id} className="flex gap-3 px-1 py-2.5 first:pt-1 last:pb-1">
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarImage
                        src={getProfilePicUrl(author?.profile_pic ?? undefined)}
                        alt=""
                      />
                      <AvatarFallback className="bg-primary/10 text-xs text-primary">
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
                          to={`/${row.file.unique_id}`}
                          className="mt-1 block truncate text-xs text-muted-foreground hover:text-foreground"
                        >
                          on {title}
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </PageBody>
  );
}
