import { useId } from "react";
import { cn } from "~/lib/utils";

interface LogoProps {
  className?: string;
  /** Fill of the shutter blades; the tile itself takes currentColor. */
  inkClassName?: string;
}

const BLADES = [
  { d: "M358 256L139.2 382.3A172 172 0 0 0 423.8 294Z", opacity: 0.86 },
  { d: "M205 344.3L205 91.7A172 172 0 0 0 139.2 382.3Z", opacity: 0.93 },
  { d: "M205 167.7L423.8 294A172 172 0 0 0 205 91.7Z", opacity: 1 },
];

/**
 * The Memories mark: a camera shutter whose opening is a play button, on a
 * rounded tile. Same geometry as scripts/brand/build-brand.mjs, which renders
 * the favicons, app icons and share card from it. Drawn in theme colours so it
 * follows the active theme; the faint sheen stands in for the icon's gradient.
 */
const Logo = ({ className, inkClassName = "fill-primary-foreground" }: LogoProps) => {
  const id = useId();
  const sheen = `${id}sheen`;
  const cut = `${id}cut`;
  return (
    <svg viewBox="0 0 512 512" className={cn("h-8 w-8 shrink-0", className)} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={sheen} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="1" stopColor="#000" stopOpacity="0.12" />
        </linearGradient>
        <mask id={cut} maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">
          <rect width="512" height="512" fill="#fff" />
          <path d="M358 256L205 344.3L205 167.7Z" fill="#000" stroke="#000" strokeWidth="10" strokeLinejoin="round" />
          <path d="M358 256L431 298.1M205 344.3L132 386.5M205 167.7L205 83.4" stroke="#000" strokeWidth="13" />
        </mask>
      </defs>
      <rect width="512" height="512" rx="116" fill="currentColor" />
      <rect width="512" height="512" rx="116" fill={`url(#${sheen})`} />
      <g mask={`url(#${cut})`} className={inkClassName}>
        {BLADES.map((b) => (
          <path key={b.d} d={b.d} fillOpacity={b.opacity} />
        ))}
      </g>
    </svg>
  );
};

export default Logo;
