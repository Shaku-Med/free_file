import { useState } from "react";
import { Link } from "react-router";
import { cn } from "~/lib/utils";
import { DashCard, Pager, studioButton } from "../components/StudioUI";
import { STUDIO_NEWS } from "./studioNews";
import { slideIn, type SlideDirection } from "./slide";

const fmtDate = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export function NewsCard() {
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<SlideDirection>("next");
  const item = STUDIO_NEWS[index];
  if (!item) return null;

  const go = (next: number) => {
    setDir(next > index ? "next" : "prev");
    setIndex(next);
  };

  return (
    <DashCard
      title="What's new in Studio"
      action={<Pager index={index} count={STUDIO_NEWS.length} onChange={go} label="Studio news" />}
    >
      <article key={item.id} className={cn("flex min-h-[10rem] flex-col", slideIn(dir))}>
        <time dateTime={item.date} className="text-xs text-muted-foreground">
          {fmtDate(item.date)}
        </time>
        <h3 className="mt-1 text-base font-semibold leading-snug text-foreground">{item.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
        {item.link && (
          <div className="mt-auto pt-4">
            <Link to={item.link.to} className={studioButton}>
              {item.link.label}
            </Link>
          </div>
        )}
      </article>
    </DashCard>
  );
}
