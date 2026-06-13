import { Link, useLocation } from "react-router";
import Logo from "~/components/Navbar/Logo/Logo";
import { SITE_NAME } from "~/lib/seo";

/** Match `BodyComponent` / `sidebar_body` horizontal padding. */
const FOOTER_SHELL = "mx-auto w-full min-w-0 px-3 sm:px-5 lg:px-8 xl:px-4";

const FOOTER_VISIBLE_PREFIXES = [
  "/privacy",
  "/terms",
  "/dmca",
  "/community-guidelines",
  "/features",
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
  "rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const FOOTER_LINKS = [
  { to: "/", label: "Home" },
  { to: "/playlist", label: "Playlists" },
  { to: "/brozystudio", label: "Studio" },
  { to: "/features/incoming", label: "Roadmap" },
  { to: "/privacy", label: "Privacy" },
  { to: "/terms", label: "Terms" },
  { to: "/dmca", label: "DMCA" },
  { to: "/community-guidelines", label: "Guidelines" },
] as const;

const Footer = () => {
  const { pathname } = useLocation();

  if (shouldHideFooter(pathname)) return null;

  return (
    <footer className="mt-auto border-t border-border/60 bg-background">
      <div className={`${FOOTER_SHELL} py-10 sm:py-12`}>
        <div className="flex flex-col gap-8 sm:gap-9">
          <div className="max-w-lg">
            <Link
              to="/"
              className="inline-flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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

          <nav
            aria-label="Footer"
            className="flex flex-wrap gap-x-4 gap-y-2 sm:gap-x-5"
          >
            {FOOTER_LINKS.map(({ to, label }) => (
              <Link key={to} to={to} className={linkClass}>
                {label}
              </Link>
            ))}
          </nav>

          <p className="max-w-lg text-xs leading-relaxed text-muted-foreground">
            Uploads stay on the platform — only share what you&apos;re comfortable
            keeping around.
          </p>

          <div className="flex flex-col gap-4 border-t border-border/50 pt-6 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <p>
              © {new Date().getFullYear()} {SITE_NAME}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <a href="mailto:abuse@memories.brozy.org" className={linkClass}>
                Report abuse
              </a>
              <a href="mailto:privacy@memories.brozy.org" className={linkClass}>
                Privacy requests
              </a>
              <a href="mailto:dmca@memories.brozy.org" className={linkClass}>
                Copyright
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
