import { useMemo, useState, type ComponentType } from "react";
import { Link } from "react-router";
import { Compass, Layers, Palette, Target, TrendingUp, Upload } from "lucide-react";
import { cn } from "~/lib/utils";
import { formatNumber } from "~/lib/utils/formatNumber";
import { useStudioData } from "~/lib/studio/studioCache";
import { DashCard, Pager, Skeleton, studioButton } from "../components/StudioUI";
import { slideIn, type SlideDirection } from "./slide";

interface TagRow {
  tag: string;
  count: number;
  views: number;
}

interface InspirationApi {
  success: boolean;
  trending?: TagRow[];
  yours?: TagRow[];
}

interface Idea {
  key: string;
  icon: ComponentType<{ className?: string }>;
  eyebrow: string;
  title: string;
  body: string;
  cta: { label: string; to: string } | { label: string; upload: true };
}

const plural = (n: number, word: string) => `${formatNumber(n)} ${word}${n === 1 ? "" : "s"}`;

const TIPS: Idea[] = [
  {
    key: "tip-series",
    icon: Layers,
    eyebrow: "Keep them watching",
    title: "Group related posts into a series",
    body: "A series lets viewers play straight through instead of hunting for part two.",
    cta: { label: "Open series", to: "/brozystudio/series" },
  },
  {
    key: "tip-customize",
    icon: Palette,
    eyebrow: "First impressions",
    title: "Make your channel page yours",
    body: "A banner and a short about line tell new visitors what you post before they press play.",
    cta: { label: "Customize", to: "/brozystudio/customization" },
  },
  {
    key: "tip-inspiration",
    icon: Compass,
    eyebrow: "Find your next post",
    title: "See what people are watching",
    body: "Trending tags from across the app, refreshed every week.",
    cta: { label: "Open inspiration", to: "/brozystudio/inspiration" },
  },
];

function buildIdeas(trending: TagRow[], yours: TagRow[]): Idea[] {
  const ideas: Idea[] = [];
  const mine = new Set(yours.map((t) => t.tag));

  for (const t of trending) {
    if (ideas.length >= 2) break;
    if (mine.has(t.tag)) continue;
    ideas.push({
      key: `trend-${t.tag}`,
      icon: TrendingUp,
      eyebrow: "Trending this week",
      title: `Try a post about #${t.tag}`,
      body: `${plural(t.views, "view")} across ${plural(t.count, "public post")} in the last 7 days. People are already looking for it.`,
      cta: { label: "See what's out there", to: `/tag/${encodeURIComponent(t.tag)}` },
    });
  }

  const best = yours[0];
  if (best && best.views > 0) {
    ideas.push({
      key: `best-${best.tag}`,
      icon: Target,
      eyebrow: "What works for you",
      title: `Your #${best.tag} posts do best`,
      body: `${plural(best.views, "view")} across ${plural(best.count, "post")} of yours. Another one in that lane is a safe bet.`,
      cta: { label: "Upload", upload: true },
    });
  }

  for (const tip of TIPS) {
    if (ideas.length >= 4) break;
    ideas.push(tip);
  }
  return ideas;
}

export function IdeasCard({ onUpload }: { onUpload: () => void }) {
  // Same key and URL as the Inspiration page, so the two share one fetch.
  const { data, loading } = useStudioData<InspirationApi>({
    cacheKey: "studio:inspiration",
    url: "/api/studio/inspiration",
    ttlMs: 5 * 60_000,
  });
  const ideas = useMemo(
    () => buildIdeas(data?.success ? data.trending ?? [] : [], data?.success ? data.yours ?? [] : []),
    [data],
  );
  const [picked, setPicked] = useState(0);
  const [dir, setDir] = useState<SlideDirection>("next");
  // The list can shrink when fresh data lands, so never point past its end.
  const index = Math.min(picked, Math.max(0, ideas.length - 1));
  const current = ideas[index];

  const go = (next: number) => {
    setDir(next > index ? "next" : "prev");
    setPicked(next);
  };

  return (
    <DashCard
      title="Ideas for you"
      action={<Pager index={index} count={ideas.length} onChange={go} label="Ideas" />}
    >
      {loading && !data ? (
        <div className="min-h-[12rem] space-y-2.5">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-3.5 w-full" />
        </div>
      ) : current ? (
        <div key={current.key} className={cn("flex min-h-[12rem] flex-col", slideIn(dir))}>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <current.icon className="h-5 w-5" aria-hidden />
          </div>
          <p className="mt-3 text-xs font-medium text-muted-foreground">{current.eyebrow}</p>
          <p className="mt-1 text-base font-semibold leading-snug text-foreground">{current.title}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{current.body}</p>
          <div className="mt-auto pt-4">
            {"upload" in current.cta ? (
              <button type="button" onClick={onUpload} className={studioButton}>
                <Upload className="h-3.5 w-3.5" aria-hidden />
                {current.cta.label}
              </button>
            ) : (
              <Link to={current.cta.to} className={studioButton}>
                {current.cta.label}
              </Link>
            )}
          </div>
        </div>
      ) : null}
    </DashCard>
  );
}
