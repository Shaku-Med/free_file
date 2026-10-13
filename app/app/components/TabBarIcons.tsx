import { useId } from "react";
import { cn } from "~/lib/utils";

export type TabIconProps = { filled: boolean; className?: string };

function Svg({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      {children}
    </svg>
  );
}

function useMaskId() {
  return `tab-mask-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

const HOUSE =
  "M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z";

export function HomeIcon({ filled, className }: TabIconProps) {
  const mask = useMaskId();
  if (!filled) {
    return (
      <Svg className={className}>
        <path d={HOUSE} />
        <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
      </Svg>
    );
  }
  return (
    <Svg className={className}>
      <mask id={mask}>
        <rect width="24" height="24" fill="#fff" stroke="none" />
        <rect x="9.75" y="13.5" width="4.5" height="10" rx="1" fill="#000" stroke="none" />
      </mask>
      <path d={HOUSE} fill="currentColor" mask={`url(#${mask})`} />
    </Svg>
  );
}

export function SubsIcon({ filled, className }: TabIconProps) {
  const fill = filled ? "currentColor" : "none";
  return (
    <Svg className={className}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2z" fill={fill} />
      <circle cx="9" cy="7" r="4" fill={fill} />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Svg>
  );
}

const PLAY = "M8.75 11.25v5.5l4.5-2.75z";

/** Two stacked frames with a play mark, like `play.rectangle.on.rectangle`. */
export function ReelIcon({ filled, className }: TabIconProps) {
  const mask = useMaskId();
  return (
    <Svg className={className}>
      <path d="M6.5 7.5V6A2.5 2.5 0 0 1 9 3.5h10A2.5 2.5 0 0 1 21.5 6v8a2.5 2.5 0 0 1-2.5 2.5h-1.5" />
      {filled ? (
        <>
          <mask id={mask}>
            <rect width="24" height="24" fill="#fff" stroke="none" />
            <path d={PLAY} fill="#000" stroke="#000" strokeWidth={1.5} />
          </mask>
          <rect x="2.5" y="7.5" width="15" height="13" rx="2.5" fill="currentColor" mask={`url(#${mask})`} />
        </>
      ) : (
        <>
          <rect x="2.5" y="7.5" width="15" height="13" rx="2.5" />
          <path d={PLAY} fill="currentColor" strokeWidth={1.5} />
        </>
      )}
    </Svg>
  );
}

/** Signed-out profile, like `person.crop.circle`. */
export function ProfileIcon({ filled, className }: TabIconProps) {
  const mask = useMaskId();
  if (!filled) {
    return (
      <Svg className={className}>
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="10" r="3" />
        <path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662" />
      </Svg>
    );
  }
  return (
    <Svg className={className}>
      <mask id={mask}>
        <rect width="24" height="24" fill="#fff" stroke="none" />
        <circle cx="12" cy="9.75" r="3.5" fill="#000" stroke="none" />
        <ellipse cx="12" cy="20.5" rx="6.5" ry="4" fill="#000" stroke="none" />
      </mask>
      <circle cx="12" cy="12" r="10.5" fill="currentColor" stroke="none" mask={`url(#${mask})`} />
    </Svg>
  );
}
