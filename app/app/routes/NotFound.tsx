import { Link, type MetaFunction } from "react-router";
import { Button } from "~/components/ui/button";
import { buildPageMeta } from "~/lib/seo";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Page not found",
    description: "The page you're looking for doesn't exist or has been moved.",
    noindex: true,
  });

export default function NotFound() {
  return (
    <div className="flex items-center justify-center min-h-[80vh] py-20 px-4">
      <div className="text-center max-w-xs space-y-6">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground" aria-hidden>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </div>

        <div className="err-enter space-y-1.5">
          <p className="text-5xl font-black tracking-tighter text-muted-foreground/15 select-none leading-none">404</p>
          <h1 className="text-lg font-semibold text-foreground">Page not found</h1>
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            This page doesn't exist. It might have been moved or deleted.
          </p>
        </div>

        <div className="err-enter-d1 flex items-center justify-center gap-3">
          <Button asChild size="default" className="rounded-full px-6">
            <Link to="/">Go home</Link>
          </Button>
          <Button asChild variant="outline" size="default" className="rounded-full px-6">
            <Link to="/search">Search</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
