import { redirect, useLoaderData, Link } from "react-router";
import type { MetaFunction } from "react-router";
import { History, ThumbsUp, Bookmark, ListVideo, Play, LibraryBig } from "lucide-react";
import db from "~/lib/Database/supabase";
import { isAuthenticated } from "~/lib/Security/Password";
import { filterFilesByAccess } from "~/routes/Api/fun/accessControl";
import { mapRpcFileRows } from "~/lib/profile/mapRpcFileRows";
import { buildPageMeta } from "~/lib/seo";
import type { FileType } from "~/lib/types";
import VideoCard from "~/routes/Home/components/VideoCard";
import EmptyState from "~/components/EmptyState";
import { FEED_HIDE_ACTIONS } from "~/lib/feed/feedVideoCardLayout";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Library – Your history, likes and saves",
    description: "Pick up where you left off: continue watching, history, liked and saved videos.",
    canonicalPath: "/library",
  });

const SECTION_LIMIT = 12;

/** Same public column set the saves list uses — nothing internal leaves the server. */
const FILE_COLUMNS =
  "id, unique_id, file_title, file_description, file_type, default_thumbnail, " +
  "view_count, share_count, is_reel, duration, categories, tags, owner_id, " +
  "endpoint, filename, created_at, is_public, is_adult, upload_status";

type LoaderData = {
  username: string;
  continueWatching: (FileType & { thumbnailProgress?: number })[];
  history: FileType[];
  liked: FileType[];
  saved: FileType[];
  userActions: { likedFileIds: string[]; dislikedFileIds: string[] };
};

export const loader = async ({ request }: { request: Request }) => {
  const user = await isAuthenticated(request, ["id", "username"]);
  if (!user?.id) return redirect("/auth/login?redirect=/library");
  if (!db) throw new Response("Service unavailable", { status: 503 });

  const [progressRes, historyRes, likedRes, savedRes] = await Promise.all([
    db
      .from("user_watch_progress")
      .select(`file_id, current_time_s, duration_s, files:file_id (${FILE_COLUMNS})`)
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(SECTION_LIMIT * 2),
    db.rpc("get_profile_watch_history", {
      p_profile_user_id: user.id,
      p_viewer_id: user.id,
      p_limit: SECTION_LIMIT,
      p_cursor_pos: 0,
    }),
    db.rpc("get_profile_liked_files", {
      p_profile_user_id: user.id,
      p_viewer_id: user.id,
      p_limit: SECTION_LIMIT,
      p_cursor_pos: 0,
    }),
    db
      .from("saved_files")
      .select(`file_id, files:file_id (${FILE_COLUMNS})`)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(SECTION_LIMIT),
  ]);

  // Continue watching: rows that are genuinely mid-watch. A file made private
  // after being watched is dropped by the access filter, never shown.
  let continueWatching: (FileType & { thumbnailProgress?: number })[] = [];
  if (!progressRes.error && Array.isArray(progressRes.data)) {
    const rows = progressRes.data as unknown as Array<{
      file_id: string;
      current_time_s: number;
      duration_s: number;
      files: FileType | null;
    }>;
    const midWatch = rows.filter((r) => {
      const dur = Number(r.duration_s) || 0;
      const pos = Number(r.current_time_s) || 0;
      if (!r.files || dur < 60) return false;
      const frac = pos / dur;
      return frac >= 0.02 && frac <= 0.95;
    });
    // Same access filter the saves list uses; FileType columns are a superset of
    // FileData's required fields, cast matches that route's convention.
    const accessible = await filterFilesByAccess(
      request,
      midWatch.map((r) => r.files) as any[],
    );
    const accessibleIds = new Set(accessible.map((f: { id: string }) => f.id));
    continueWatching = midWatch
      .filter((r) => r.files && accessibleIds.has(r.files.id))
      .slice(0, SECTION_LIMIT)
      .map((r) => ({
        ...(r.files as FileType),
        thumbnailProgress: Math.min(1, (Number(r.current_time_s) || 0) / (Number(r.duration_s) || 1)),
      }));
  }

  const historyMapped = mapRpcFileRows(Array.isArray(historyRes.data) ? historyRes.data : []);
  const likedMapped = mapRpcFileRows(Array.isArray(likedRes.data) ? likedRes.data : []);

  let saved: FileType[] = [];
  if (!savedRes.error && Array.isArray(savedRes.data)) {
    const files = (savedRes.data as unknown as Array<{ files: FileType | null }>)
      .map((r) => r.files)
      .filter(Boolean) as FileType[];
    saved = (await filterFilesByAccess(request, files as any[])) as FileType[];
  }

  const likedFileIds = Array.from(
    new Set([...historyMapped.likedFileIds, ...likedMapped.likedFileIds]),
  );
  const dislikedFileIds = Array.from(
    new Set([...historyMapped.dislikedFileIds, ...likedMapped.dislikedFileIds]),
  );

  return {
    username: String(user.username ?? ""),
    continueWatching,
    history: historyMapped.files,
    liked: likedMapped.files,
    saved,
    userActions: { likedFileIds, dislikedFileIds },
    currentUserId: user.id as string,
  };
};

function SectionHeader({
  icon: Icon,
  title,
  seeAllTo,
}: {
  icon: typeof History;
  title: string;
  seeAllTo?: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
        <Icon className="size-4 text-muted-foreground" />
        {title}
      </h2>
      {seeAllTo && (
        <Link
          to={seeAllTo}
          className="rounded-full px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          See all
        </Link>
      )}
    </div>
  );
}

export default function Library() {
  const {
    username,
    continueWatching,
    history,
    liked,
    saved,
    userActions,
    currentUserId,
  } = useLoaderData<LoaderData & { currentUserId: string }>();

  const actions = {
    likedFileIds: new Set(userActions.likedFileIds),
    dislikedFileIds: new Set(userActions.dislikedFileIds),
  };
  const profileBase = username ? `/profile/${encodeURIComponent(username)}` : null;

  const sections: {
    key: string;
    icon: typeof History;
    title: string;
    files: (FileType & { thumbnailProgress?: number })[];
    seeAllTo?: string;
  }[] = [
    { key: "continue", icon: Play, title: "Continue watching", files: continueWatching },
    {
      key: "history",
      icon: History,
      title: "History",
      files: history,
      seeAllTo: profileBase ? `${profileBase}?tab=history` : undefined,
    },
    {
      key: "liked",
      icon: ThumbsUp,
      title: "Liked",
      files: liked,
      seeAllTo: profileBase ? `${profileBase}?tab=liked` : undefined,
    },
    { key: "saved", icon: Bookmark, title: "Saved", files: saved },
  ];
  const nonEmpty = sections.filter((s) => s.files.length > 0);

  return (
    <div className="w-full max-w-full overflow-x-hidden">
      <div className="space-y-8 px-3 py-5 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-foreground">Library</h1>
          <Link
            to="/playlist"
            className="flex items-center gap-1.5 rounded-full bg-muted/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <ListVideo className="size-3.5" />
            Playlists
          </Link>
        </div>

        {nonEmpty.length === 0 ? (
          <EmptyState
            icon={LibraryBig}
            title="Your library is empty"
            description="Videos you watch, like or save will show up here so you can pick up where you left off."
          />
        ) : (
          nonEmpty.map((section) => (
            <section key={section.key}>
              <SectionHeader
                icon={section.icon}
                title={section.title}
                seeAllTo={section.seeAllTo}
              />
              <div className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {section.files.map((file, index) => (
                  <div key={`${section.key}-${file.id || index}`} className="min-w-0">
                    <VideoCard
                      data={file}
                      index={index}
                      currentUserId={currentUserId}
                      userActions={actions}
                      hideActions={FEED_HIDE_ACTIONS}
                      thumbnailProgress={file.thumbnailProgress}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
