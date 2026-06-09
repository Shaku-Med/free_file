import type React from "react";
import { Fragment } from "react";
import { Link } from "react-router";
import { cn } from "~/lib/utils";

const MD_LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

const URL_RE = /(?:https?:\/\/[^\s<>\[\]()]+|www\.[^\s<>\[\]()]+)/gi;
const EMAIL_RE = /(?:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
const PHONE_RE = /(?:\+?[\d][\d\s\-().]{9,}\d|\(\d{3}\)\s*\d{3}[-.\s]?\d{4})/g;

const HASHTAG_OR_MENTION = /(?:#[\w-]+)|(?:@[\w.-]+)/g;

type Segment =
  | { type: "text"; value: string; bold?: boolean; italic?: boolean; code?: boolean }
  | { type: "url"; value: string; href: string }
  | { type: "email"; value: string }
  | { type: "phone"; value: string }
  | { type: "mdlink"; label: string; href: string }
  | { type: "hashtag"; value: string }
  | { type: "mention"; value: string }
  | { type: "timestamp"; value: string; seconds: number };

/**
 * Matches video-style timestamps: M:SS, MM:SS, H:MM:SS, HH:MM:SS.
 *  - Seconds must be 00-59 (the regex enforces it)
 *  - Hours / minutes are unconstrained at parse time; we filter against
 *    the actual video duration when rendering, so "99:59" parses but
 *    won't render as a link if the video is shorter.
 *  - Word boundaries on both sides so "v1.2.3" / "tel:1234" don't false-positive
 */
const TIMESTAMP_RE = /\b(\d{1,2}):([0-5]\d)(?::([0-5]\d))?\b/g;

function timestampToSeconds(m: RegExpExecArray): number {
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = m[3] != null ? Number(m[3]) : null;
  if (c == null) return a * 60 + b; // M:SS
  return a * 3600 + b * 60 + c;     // H:MM:SS
}

/** Global event the player listens to. Decouples comment rendering from
 *  the player so any mounted player (main, mini, embed) can react. */
export const SEEK_TO_EVENT = "memories:seek-to";

export interface SeekToEventDetail {
  seconds: number;
  /** Optional fileId  if provided, players ignore the event unless their
   *  current file matches. Useful for embeds on profile pages. */
  fileId?: string;
}

export function dispatchSeekTo(detail: SeekToEventDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<SeekToEventDetail>(SEEK_TO_EVENT, { detail }));
}

const LINKIFY_REGEX = new RegExp(
  `(${URL_RE.source})|(${EMAIL_RE.source})|(${PHONE_RE.source})`,
  "gi"
);

function linkifyLine(line: string): Segment[] {
  const segments: Segment[] = [];
  let remaining = line;

  MD_LINK.lastIndex = 0;
  let match = MD_LINK.exec(line);
  if (match) {
    const rebuilt: string[] = [];
    let lastIndex = 0;
    do {
      if (match.index > lastIndex) rebuilt.push(line.slice(lastIndex, match.index));
      rebuilt.push(`\x00MDLINK:${match[1]}\x01${match[2]}\x00`);
      lastIndex = MD_LINK.lastIndex;
    } while ((match = MD_LINK.exec(line)) !== null);
    if (lastIndex < line.length) rebuilt.push(line.slice(lastIndex));
    remaining = rebuilt.join("");
  }

  let pos = 0;
  let m;
  LINKIFY_REGEX.lastIndex = 0;
  while ((m = LINKIFY_REGEX.exec(remaining)) !== null) {
    const before = remaining.slice(pos, m.index);
    if (before) pushTextWithMdLinks(before, segments);
    const full = m[0];
    if (m[1]) {
      const href = full.toLowerCase().startsWith("http") ? full : `https://${full}`;
      segments.push({ type: "url", value: full, href });
    } else if (m[2]) {
      segments.push({ type: "email", value: full });
    } else {
      segments.push({ type: "phone", value: full });
    }
    pos = LINKIFY_REGEX.lastIndex;
  }
  const after = remaining.slice(pos);
  if (after) pushTextWithMdLinks(after, segments);

  return segments;
}

function pushTextWithMdLinks(s: string, segments: Segment[]) {
  const parts = s.split(/\x00MDLINK:([^\x01]+)\x01([^\x00]+)\x00/);
  for (let i = 0; i < parts.length; i += 3) {
    if (parts[i]) pushMarkdownSegments(parts[i], segments);
    if (parts[i + 1] != null && parts[i + 2] != null) {
      segments.push({ type: "mdlink", label: parts[i + 1], href: parts[i + 2] });
    }
  }
}

function pushTextWithHashtagMention(s: string, segments: Segment[]) {
  if (!s) return;
  HASHTAG_OR_MENTION.lastIndex = 0;
  let pos = 0;
  let m;
  while ((m = HASHTAG_OR_MENTION.exec(s)) !== null) {
    if (m.index > pos) segments.push({ type: "text", value: s.slice(pos, m.index) });
    const matched = m[0];
    if (matched.startsWith("#")) {
      segments.push({ type: "hashtag", value: matched });
    } else if (matched.startsWith("@")) {
      segments.push({ type: "mention", value: matched });
    }
    pos = HASHTAG_OR_MENTION.lastIndex;
  }
  if (pos < s.length) segments.push({ type: "text", value: s.slice(pos) });
}

function pushMarkdownSegments(text: string, segments: Segment[]) {
  const re = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)/g;
  let lastEnd = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastEnd) {
      pushTextWithHashtagMention(text.slice(lastEnd, match.index), segments);
    }
    if (match[2] !== undefined) {
      segments.push({ type: "text", value: match[2], bold: true });
    } else if (match[4] !== undefined) {
      segments.push({ type: "text", value: match[4], italic: true });
    } else if (match[6] !== undefined) {
      segments.push({ type: "text", value: match[6], code: true });
    }
    lastEnd = re.lastIndex;
  }
  if (lastEnd < text.length) {
    pushTextWithHashtagMention(text.slice(lastEnd), segments);
  }
}

/**
 * Walk an already-built segment list and replace plain text containing
 * timestamps with explicit timestamp segments. Runs as a post-pass so it
 * never interferes with phone numbers / URLs / markdown links (those
 * segments aren't touched).
 *
 * `maxSeconds` filters out absurd numbers (e.g. "99:59" on a 30s clip).
 * If unset, every parseable timestamp becomes a link  the player
 * silently no-ops when seeking past the end.
 */
function expandTimestamps(segments: Segment[], maxSeconds?: number): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    if (seg.type !== "text" || seg.bold || seg.italic || seg.code) {
      out.push(seg);
      continue;
    }
    const s = seg.value;
    TIMESTAMP_RE.lastIndex = 0;
    let pos = 0;
    let m: RegExpExecArray | null;
    let matched = false;
    while ((m = TIMESTAMP_RE.exec(s)) !== null) {
      const seconds = timestampToSeconds(m);
      if (maxSeconds != null && seconds > maxSeconds) continue;
      if (seconds < 0) continue;
      matched = true;
      if (m.index > pos) out.push({ type: "text", value: s.slice(pos, m.index) });
      out.push({ type: "timestamp", value: m[0], seconds });
      pos = TIMESTAMP_RE.lastIndex;
    }
    if (matched) {
      if (pos < s.length) out.push({ type: "text", value: s.slice(pos) });
    } else {
      out.push(seg);
    }
  }
  return out;
}

function renderSegments(
  segments: Segment[],
  keyPrefix: string,
  mentionLinkClassName?: string,
  timestampFileId?: string,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let i = 0;
  for (const seg of segments) {
    const k = `${keyPrefix}-${i}`;
    if (seg.type === "text") {
      let content: React.ReactNode = seg.value;
      if (seg.code) {
        content = (
          <code key={k} className="rounded bg-muted px-1 py-0.5 text-sm font-mono whitespace-pre-wrap">
            {seg.value}
          </code>
        );
      } else if (seg.bold) {
        content = <strong key={k} className="whitespace-pre-wrap">{seg.value}</strong>;
      } else if (seg.italic) {
        content = <em key={k} className="whitespace-pre-wrap">{seg.value}</em>;
      } else {
        content = <span key={k} className="whitespace-pre-wrap">{seg.value}</span>;
      }
      out.push(content);
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
        <a key={k} href={`mailto:${seg.value}`} className="text-primary hover:underline break-all">
          {seg.value}
        </a>
      );
    } else if (seg.type === "phone") {
      const tel = seg.value.replace(/\s/g, "").replace(/[().-]/g, "");
      out.push(
        <a key={k} href={`tel:${tel}`} className="text-primary hover:underline">
          {seg.value}
        </a>
      );
    } else if (seg.type === "mdlink") {
      // Only true same-origin paths get an in-app <Link>. Protocol-relative
      // hrefs ("//evil.com") start with "/" but navigate OFF-site, so they must
      // NOT be treated as relative  otherwise a friendly-labelled comment link
      // becomes a stealth open-redirect. They fall through to the external <a>.
      const isRelative =
        (seg.href.startsWith("/") && !seg.href.startsWith("//")) ||
        seg.href.startsWith("#");
      if (isRelative) {
        out.push(
          <Link key={k} to={seg.href} className="text-primary hover:underline">
            {seg.label}
          </Link>
        );
      } else {
        const href = seg.href.toLowerCase().startsWith("http") ? seg.href : `https://${seg.href}`;
        out.push(
          <a
            key={k}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline break-all"
          >
            {seg.label}
          </a>
        );
      }
    } else if (seg.type === "hashtag") {
      const tag = seg.value.slice(1);
      out.push(
        <Link
          key={k}
          to={`/tag/${encodeURIComponent(tag)}`}
          className="text-primary hover:underline"
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
          className={cn(
            "font-medium text-primary hover:underline",
            mentionLinkClassName,
          )}
        >
          {seg.value}
        </Link>
      );
    } else if (seg.type === "timestamp") {
      const seconds = seg.seconds;
      out.push(
        <button
          key={k}
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dispatchSeekTo({ seconds, fileId: timestampFileId });
          }}
          className="font-medium text-primary tabular-nums hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm align-baseline"
          aria-label={`Jump to ${seg.value}`}
        >
          {seg.value}
        </button>
      );
    }
    i++;
  }
  return out;
}

export interface FormattedTextProps {
  text: string;
  className?: string;
  /** Applied to @mention profile links only (e.g. YouTube-style blue in comments). */
  mentionLinkClassName?: string;
  /**
   * Detect M:SS / H:MM:SS timestamps in the text and render them as
   * clickable buttons that dispatch a `memories:seek-to` window event.
   * Set this on comment sections / descriptions on the watch page.
   *
   * `maxSeconds` filters out timestamps that exceed the actual video
   * length \u2014 pass the video's duration so "99:59 lol" doesn't become
   * a link on a 30-second clip.
   *
   * `fileId` is forwarded in the seek event so embeds on other pages
   * can ignore seeks meant for a different file.
   */
  timestamps?: { maxSeconds?: number; fileId?: string } | boolean;
}

export function FormattedText({
  text,
  className,
  mentionLinkClassName,
  timestamps,
}: FormattedTextProps) {
  if (!text) return null;

  const tsOpts =
    timestamps === true ? {} : timestamps === false || timestamps == null ? null : timestamps;

  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    let segments = linkifyLine(lines[i]);
    if (tsOpts) segments = expandTimestamps(segments, tsOpts.maxSeconds);
    const lineKey = `line-${i}`;
    const rendered = renderSegments(
      segments,
      lineKey,
      mentionLinkClassName,
      tsOpts?.fileId,
    );
    nodes.push(
      <Fragment key={lineKey}>
        {rendered.length > 0 ? rendered : "\u00A0"}
      </Fragment>
    );
    if (i < lines.length - 1) {
      nodes.push(<br key={`br-${i}`} />);
    }
  }

  return (
    <span className={cn("whitespace-pre-wrap break-words", className)}>{nodes}</span>
  );
}