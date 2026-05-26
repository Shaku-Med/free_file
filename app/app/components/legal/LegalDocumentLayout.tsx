import { Link } from "react-router";
import { cn } from "~/lib/utils";

export const LEGAL_NAV = [
  { key: "privacy", href: "/privacy", label: "Privacy" },
  { key: "terms", href: "/terms", label: "Terms" },
  { key: "dmca", href: "/dmca", label: "DMCA" },
  { key: "guidelines", href: "/community-guidelines", label: "Guidelines" },
] as const;

export type LegalNavKey = (typeof LEGAL_NAV)[number]["key"];

export type LegalTocItem = { id: string; label: string };

const EFFECTIVE_DATE = "May 25, 2026";

export function LegalDocumentLayout({
  title,
  summary,
  effectiveDate = EFFECTIVE_DATE,
  activeNav,
  toc,
  children,
}: {
  title: string;
  summary?: string;
  effectiveDate?: string;
  activeNav: LegalNavKey;
  toc: LegalTocItem[];
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl py-6 sm:py-8 lg:py-10 mandatory_select">
      <nav
        className="mb-6 flex flex-wrap gap-2"
        aria-label="Legal documents"
      >
          {LEGAL_NAV.map((item) => (
            <Link
              key={item.key}
              to={item.href}
              aria-current={activeNav === item.key ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                activeNav === item.key
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-border/60 bg-card/40 text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
      </nav>

      {toc.length > 0 && (
        <nav
          aria-label="On this page"
          className="mb-4 flex gap-2 overflow-x-auto pb-1 lg:hidden"
        >
          {toc.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="shrink-0 rounded-full border border-border/60 bg-card/40 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)] lg:gap-8 xl:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
        {toc.length > 0 && (
          <aside className="hidden lg:block lg:sticky lg:top-[calc(3.5rem+1rem)] lg:self-start">
            <nav
              aria-label="On this page"
              className="rounded-xl border border-border/60 bg-card/40 p-4"
            >
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                On this page
              </p>
              <ul className="space-y-0.5">
                {toc.map((item) => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      className="block rounded-md px-2 py-1.5 text-sm leading-snug text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>
        )}

        <article className="min-w-0 rounded-xl border border-border/60 bg-card/30 p-5 sm:p-6 lg:p-8">
          <header className="mb-8 border-b border-border/50 pb-6">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {title}
            </h1>
            {summary ? (
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                {summary}
              </p>
            ) : null}
            <p className="mt-4 text-xs text-muted-foreground">Effective {effectiveDate}</p>
          </header>

          <div className="space-y-8">{children}</div>
        </article>
      </div>
    </div>
  );
}

export function LegalSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-base font-semibold text-foreground sm:text-lg">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function LegalP({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-7 text-muted-foreground">{children}</p>;
}

export function LegalUL({ children }: { children: React.ReactNode }) {
  return (
    <ul className="list-disc space-y-2 pl-5 text-sm leading-7 text-muted-foreground marker:text-muted-foreground/60">
      {children}
    </ul>
  );
}

export function LegalOL({ children }: { children: React.ReactNode }) {
  return (
    <ol className="list-decimal space-y-2 pl-5 text-sm leading-7 text-muted-foreground marker:text-muted-foreground/60">
      {children}
    </ol>
  );
}

export function LegalLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="font-medium text-primary underline-offset-4 hover:underline"
    >
      {children}
    </Link>
  );
}

export function LegalContactCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-sm leading-7 text-muted-foreground">
      {children}
    </div>
  );
}
