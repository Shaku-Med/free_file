import { Link, useLocation } from "react-router";
import Logo from "~/components/Navbar/Logo/Logo";
import { cn } from "~/lib/utils";
import { SITE_NAME } from "~/lib/seo";

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
  "inline-block rounded-md py-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function FooterLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <li>
      <Link to={to} className={linkClass}>
        {children}
      </Link>
    </li>
  );
}

function FooterColumn({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">
        {title}
      </h3>
      <ul className="mt-3 space-y-1.5">{children}</ul>
    </div>
  );
}

const Footer = () => {
  const { pathname } = useLocation();

  if (shouldHideFooter(pathname)) return null;

  return (
    <footer className="mt-auto border-t border-border/60 bg-background">
      <div className="mx-auto w-full max-w-6xl px-3 py-8 sm:px-5 sm:py-10 lg:px-8">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-12 lg:gap-10">
          <div className="min-w-0 sm:col-span-2 lg:col-span-5">
            <Link
              to="/"
              className="inline-flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Logo className="h-8 w-8 shrink-0 text-foreground" />
              <span className="text-base font-semibold tracking-tight text-foreground">
                {SITE_NAME}
              </span>
            </Link>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Upload, share, and keep your photos and videos. Choose what stays
              public or private.
            </p>
            <p className="mt-4 max-w-sm rounded-lg border border-border/50 bg-card/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              Uploads are permanent. Only share content you&apos;re comfortable
              keeping on the platform.
            </p>
          </div>

          <FooterColumn title="Platform" className="lg:col-span-2">
            <FooterLink to="/">Home</FooterLink>
            <FooterLink to="/playlist">Playlists</FooterLink>
            <FooterLink to="/brozystudio">Studio</FooterLink>
            <FooterLink to="/features/incoming">Features</FooterLink>
          </FooterColumn>

          <FooterColumn title="Legal" className="lg:col-span-2">
            <FooterLink to="/privacy">Privacy</FooterLink>
            <FooterLink to="/terms">Terms</FooterLink>
            <FooterLink to="/dmca">DMCA</FooterLink>
            <FooterLink to="/community-guidelines">Guidelines</FooterLink>
          </FooterColumn>

          <FooterColumn title="Support" className="lg:col-span-3">
            <li>
              <a href="mailto:abuse@memories.brozy.org" className={linkClass}>
                Report abuse
              </a>
            </li>
            <li>
              <a href="mailto:privacy@memories.brozy.org" className={linkClass}>
                Privacy requests
              </a>
            </li>
            <li>
              <a href="mailto:dmca@memories.brozy.org" className={linkClass}>
                Copyright (DMCA)
              </a>
            </li>
          </FooterColumn>
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-border/50 pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {SITE_NAME}. All rights reserved.
          </p>
          <p className="sm:text-right">memories.brozy.org</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
