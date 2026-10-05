import { useId } from "react";
import { cn } from "~/lib/utils";

interface LogoProps {
  className?: string;
  /** Colour of the M and play mark; the tile itself takes currentColor. */
  inkClassName?: string;
}

/**
 * The Memories mark: an M with a play triangle, on a rounded tile. Same
 * geometry as scripts/brand/build-brand.mjs, which renders the favicons, app
 * icons and share card from it. Drawn in theme colours so it follows the
 * active theme; the faint sheen stands in for the exported icon's gradient.
 */
const Logo = ({ className, inkClassName = "fill-primary-foreground stroke-primary-foreground" }: LogoProps) => {
  const sheen = useId();
  return (
    <svg viewBox="0 0 512 512" className={cn("h-8 w-8 shrink-0", className)} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={sheen} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="1" stopColor="#000" stopOpacity="0.12" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill="currentColor" />
      <rect width="512" height="512" rx="116" fill={`url(#${sheen})`} />
      <g className={inkClassName}>
        <path
          d="M116 372 V174 a34 34 0 0 1 55 -27 L256 216 L341 147 a34 34 0 0 1 55 27 V372"
          fill="none"
          strokeWidth="52"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M236 282 L236 358 L298 320 Z" strokeWidth="22" strokeLinejoin="round" />
      </g>
    </svg>
  );
};

export default Logo;
