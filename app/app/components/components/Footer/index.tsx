import { Link, useLocation } from "react-router";
import Logo from "~/components/Navbar/Logo/Logo";
import { SITE_NAME } from "~/lib/seo";

const FOOTER_VISIBLE_PREFIXES = [
  "/privacy",
  "/terms",
  "/dmca",
  "/community-guidelines",
  "/features",
  "/download",
  "/auth",
  "/api",
  "/playlist",
  "/profile",
  "/subscriptions",
  "/settings",
  "/notifications",
  "/upload",
  "/brozystudio",
  "/tag/",
];

const FOOTER_VISIBLE_EXACT = new Set(["/"]);

function shouldHideFooter(pathname: string): boolean {
  if (pathname === "/search" || pathname.startsWith("/search/")) return true;
  if (pathname.startsWith("/reel")) return true;

  if (FOOTER_VISIBLE_EXACT.has(pathname)) return false;
  if (FOOTER_VISIBLE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
    return false;
  }

  const segments = pathname.split("/").filter(Boolean);
  return segments.length === 1;
}

const linkClass =
  "inline-block rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const headingClass =
  "text-[11px] font-semibold uppercase tracking-wider text-foreground/70";

/** Grouped rather than one long row, so nine links stay scannable. */
const FOOTER_SECTIONS: ReadonlyArray<{
  heading: string;
  links: ReadonlyArray<{ to: string; label: string }>;
}> = [
  {
    heading: "Explore",
    links: [
      { to: "/", label: "Home" },
      { to: "/subscriptions", label: "Subscriptions" },
      { to: "/playlist", label: "Playlists" },
    ],
  },
  {
    heading: "Create",
    links: [
      { to: "/brozystudio", label: "Studio" },
      { to: "/download", label: "Download" },
      { to: "/features/incoming", label: "Roadmap" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { to: "/privacy", label: "Privacy" },
      { to: "/terms", label: "Terms" },
      { to: "/dmca", label: "DMCA" },
      { to: "/community-guidelines", label: "Guidelines" },
    ],
  },
];

const CONTACTS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "mailto:abuse@memories.brozy.org", label: "Report abuse" },
  { href: "mailto:privacy@memories.brozy.org", label: "Privacy requests" },
  { href: "mailto:dmca@memories.brozy.org", label: "Copyright" },
];

const Footer = () => {
  const { pathname } = useLocation();

  if (shouldHideFooter(pathname)) return null;

  return (
    <footer className="mt-auto border-t border-border/60 bg-background">
      {/* app_gutter rather than repeating the shell's four padding values. */}
      <div className="app_gutter mx-auto w-full min-w-0 max-w-[1600px] py-10 sm:py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] lg:gap-8">
          <div className="max-w-sm">
            <Link
              to="/"
              className="inline-flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Logo className="h-8 w-8 shrink-0 text-foreground" />
              <span className="text-base font-semibold tracking-tight text-foreground">
                {SITE_NAME}
              </span>
            </Link>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Upload and share photos and videos your way. Keep things public,
              private, or somewhere in between.
            </p>
          </div>

          {FOOTER_SECTIONS.map((section) => (
            <nav key={section.heading} aria-label={section.heading}>
              <h2 className={headingClass}>{section.heading}</h2>
              <ul className="mt-3 space-y-2">
                {section.links.map(({ to, label }) => (
                  <li key={to}>
                    <Link to={to} className={linkClass}>
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-border/50 pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {SITE_NAME}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {CONTACTS.map(({ href, label }) => (
              <a key={href} href={href} className={linkClass}>
                {label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
