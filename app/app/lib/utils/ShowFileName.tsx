import type React from "react";
import { Link } from "react-router";

const URL_RE = /(?:https?:\/\/[^\s<>\[\]()]+|www\.[^\s<>\[\]()]+)/gi;
const EMAIL_RE = /(?:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
const HASHTAG_RE = /(?:#[\w-]+)/g;
const MENTION_RE = /(?:@[\w.-]+)/g;

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
        <span key={k} className="break-all">
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
          className="text-primary hover:underline break-all"
        >
          {seg.value}
        </a>
      );
    } else if (seg.type === "email") {
      out.push(
        <a
          key={k}
          href={`mailto:${seg.value}`}
          className="text-primary hover:underline break-all"
        >
          {seg.value}
        </a>
      );
    } else if (seg.type === "hashtag") {
      const tag = seg.value.slice(1);
      out.push(
        <Link
          key={k}
          to={`/tag/${encodeURIComponent(tag)}`}
          className="text-primary hover:text-primary/50 hover:underline"
        >
          {seg.value}
        </Link>
      );
    } else if (seg.type === "mention") {
      const username = seg.value.slice(1);
      out.push(
        <Link
          key={k}
          to={`/profile/${encodeURIComponent(username)}`}
          className="text-primary hover:text-primary/50 hover:underline font-medium"
        >
          {seg.value}
        </Link>
      );
    }
  });
  return out;
}

export const splitFineName = (filename: string, showLimit?: number) => {
  const chars = Array.from(filename);
  const limited = chars.slice(0, showLimit ?? chars.length);
  return limited;
};

interface ParseFilenameProps {
  filename: string;
  showLimit?: number;
  className?: string;
  characterSplit?: boolean;
}

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
      <span className={className}>
        {chars.map((part, index) => (
          <span key={index}>
            {part === " " ? "\u00A0" : part}
          </span>
        ))}
        {showLimit != null && showLimit > 0 && display.length > showLimit && "..."}
      </span>
    );
  }

  const truncated =
    showLimit != null && showLimit > 0 && display.length > showLimit
      ? display.slice(0, showLimit) + "..."
      : display;
  const segments = parseWithLinks(truncated);
  const nodes = renderSegments(segments, "fn");

  return (
    <span className={className}>
      {nodes.length > 0 ? nodes : truncated}
    </span>
  );
}