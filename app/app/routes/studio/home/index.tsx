import { useCallback } from "react";
import type { MetaFunction } from "react-router";
import { buildPageMeta } from "~/lib/seo";
import { useStudioData } from "~/lib/studio/studioCache";
import { useFileContext } from "~/lib/Context/Context";
import { ErrorNote, PageBody } from "../components/StudioUI";
import { DashboardHeader } from "./DashboardHeader";
import { LatestPostCard } from "./LatestPostCard";
import { ChannelAnalyticsCard } from "./ChannelAnalyticsCard";
import { CommentsCard } from "./CommentsCard";
import { UploadsCard } from "./UploadsCard";
import { IdeasCard } from "./IdeasCard";
import { NewsCard } from "./NewsCard";
import type { DashboardResponse } from "./dashboardTypes";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Channel dashboard | Memories",
    description: "Brozy Studio: your latest post, channel numbers, uploads and ideas in one place.",
    canonicalPath: "/brozystudio",
  });

export default function StudioHomePage() {
  const { setIsModalOpen, userProfile } = useFileContext();
  const openUpload = useCallback(() => setIsModalOpen(true), [setIsModalOpen]);

  const { data: raw, loading, error } = useStudioData<DashboardResponse>({
    cacheKey: "studio:dashboard",
    url: "/api/studio/dashboard",
    ttlMs: 60_000,
  });
  const data = raw?.success ? raw : null;

  return (
    // A container, so the columns follow the room the dashboard actually has:
    // the app's own sidebar can take a third of a laptop screen.
    <PageBody className="@container">
      <DashboardHeader />

      {error && <ErrorNote>Could not load your dashboard. Try refreshing.</ErrorNote>}

      {/* Three independent stacks rather than one grid, so a tall card never
          leaves a hole beside a short one. With two columns the third stack
          spreads across both. Every grid names its columns: an implicit one
          grows to fit its longest line and pushes cards off the screen. */}
      <div className="grid grid-cols-1 items-start gap-4 @3xl:grid-cols-2 @6xl:grid-cols-3">
        <div className="grid min-w-0 grid-cols-1 gap-4">
          <LatestPostCard post={data?.latest ?? null} loading={loading} onUpload={openUpload} />
          <CommentsCard />
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-4">
          <ChannelAnalyticsCard data={data} loading={loading} username={userProfile?.username} />
          <UploadsCard onUpload={openUpload} />
        </div>
        <div className="grid min-w-0 grid-cols-1 items-start gap-4 @3xl:col-span-2 @3xl:grid-cols-2 @6xl:col-span-1 @6xl:grid-cols-1">
          <IdeasCard onUpload={openUpload} />
          <NewsCard />
        </div>
      </div>
    </PageBody>
  );
}
