import type React from "react";
import { Link } from "react-router";

// Use non-capturing groups (?:) so .source doesn't add extra capture groups
const URL_RE = /(?:https?:\/\/[^\s<>\[\]()]+|www\.[^\s<>\[\]()]+)/gi;
const EMAIL_RE = /(?:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
const HASHTAG_RE = /(?:#[\w-]+)/g;
const MENTION_RE = /(?:@[\w.-]+)/g;

// Exactly 4 capture groups: m[1]=URL, m[2]=EMAIL, m[3]=HASHTAG, m[4]=MENTION
const LINKIFY_REGEX = new RegExp(
  `(${URL_RE.source})|(${EMAIL_RE.source})|(${HASHTAG_RE.source})|(${MENTION_RE.source})`,
  "gi"
);

type Segment =
  | { type: "text"; value: string }
  | { type: "url"; value: string; href: string }
  | { type: "email"; value: string }
  | { type: "hashtag"; value: string }
  | { type: "mention"; value: string };

function parseWithLinks(text: string): Segment[] {
  const segments: Segment[] = [];
  let pos = 0;
  let m;
  LINKIFY_REGEX.lastIndex = 0;
  while ((m = LINKIFY_REGEX.exec(text)) !== null) {
    const before = text.slice(pos, m.index);
    if (before) segments.push({ type: "text", value: before });
    const full = m[0];
    // Determine type by leading character — bulletproof regardless of group numbering
    if (full.match(/^https?:\/\//i) || full.match(/^www\./i)) {
      const href = full.toLowerCase().startsWith("http") ? full : `https://${full}`;
      segments.push({ type: "url", value: full, href });
    } else if (full.includes("@") && full.includes(".") && !full.startsWith("@")) {
      segments.push({ type: "email", value: full });
    } else if (full.startsWith("#")) {
      segments.push({ type: "hashtag", value: full });
    } else if (full.startsWith("@")) {
      segments.push({ type: "mention", value: full });
    }
    pos = LINKIFY_REGEX.lastIndex;
  }
  const after = text.slice(pos);
  if (after) segments.push({ type: "text", value: after });
  return segments;
}

function renderSegments(segments: Segment[], keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  segments.forEach((seg, i) => {
    const k = `${keyPrefix}-${i}`;
    if (seg.type === "text") {
      out.push(
        <span key={k} className="inline">
          {seg.value}
        </span>
      );
    } else if (seg.type === "url") {
      out.push(
        <a
          key={k}
          href={seg.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline break-all inline"
        >
          {seg.value}
        </a>
      );
    } else if (seg.type === "email") {
      out.push(
        <a
          key={k}
          href={`mailto:${seg.value}`}
          className="text-primary hover:underline break-all inline"
        >
          {seg.value}
        </a>
      );
    } else if (seg.type === "hashtag") {
      const tag = seg.value.slice(1); // strip leading #
      out.push(
        <Link
          key={k}
          to={`/tag/${encodeURIComponent(tag)}`}
          className="text-primary hover:text-primary/50 hover:underline inline"
        >
          {seg.value}
        </Link>
      );
    } else if (seg.type === "mention") {
      const username = seg.value.slice(1); // strip leading @
      out.push(
        <Link
          key={k}
          to={`/profile/${encodeURIComponent(username)}`}
          className="text-primary hover:text-primary/50 hover:underline font-medium inline"
        >
          {seg.value}
        </Link>
      );
    }
  });
  return out;
}

/** Splits filename into single-character array, optionally limited (legacy helper). */
export const splitFineName = (filename: string, showLimit?: number) => {
  const chars = Array.from(filename);
  const limited = chars.slice(0, showLimit ?? chars.length);
  return limited;
};

interface ParseFilenameProps {
  filename: string;
  showLimit?: number;
  className?: string;
  /** When true, use the old character-by-character split (one span per char, spaces get ml-1). When false, linkify URLs, emails, #hashtags, @mentions. */
  characterSplit?: boolean;
}

/**
 * Renders filename. Two modes:
 * - characterSplit: true → one span per character (original behavior), with showLimit and "..." when truncated.
 * - characterSplit: false/undefined → linkified URLs, emails, #hashtags, @mentions.
 */
export default function ParseFilenameInsert({
  filename,
  showLimit,
  className,
  characterSplit = false,
}: ParseFilenameProps) {
  const display = typeof filename !== "string" ? "" : filename;

  if (characterSplit) {
    const chars = splitFineName(display, showLimit);
    return (
      <div className={className ? `flex flex-wrap ${className}` : "flex flex-wrap"}>
        {chars.map((part, index) => (
          <span key={index} className="inline">
            <span>{part}</span>
            {part.trim().length < 1 && <span className="ml-1" />}
          </span>
        ))}
        {showLimit != null && showLimit > 0 && display.length > showLimit && "..."}
      </div>
    );
  }

  const truncated =
    showLimit != null && showLimit > 0 && display.length > showLimit
      ? display.slice(0, showLimit) + "..."
      : display;
  const segments = parseWithLinks(truncated);
  const nodes = renderSegments(segments, "fn");

  return (
    <div className={className ? `flex flex-wrap ${className} break-all` : "flex flex-wrap break-all"}>
      {nodes.length > 0 ? nodes : truncated}
    </div>
  );
}
