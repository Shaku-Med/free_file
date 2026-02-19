import type React from "react";
import { Fragment } from "react";
import { Link } from "react-router";
import { cn } from "~/lib/utils";

const MD_LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

// Use non-capturing groups (?:) inside each pattern so .source doesn't add extra capture groups
const URL_RE = /(?:https?:\/\/[^\s<>\[\]()]+|www\.[^\s<>\[\]()]+)/gi;
const EMAIL_RE = /(?:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
const PHONE_RE = /(?:\+?[\d][\d\s\-().]{9,}\d|\(\d{3}\)\s*\d{3}[-.\s]?\d{4})/g;

// #hashtag: starts with # followed by word chars / hyphens
// @mention: starts with @ followed by word chars / dots / hyphens
const HASHTAG_OR_MENTION = /(?:#[\w-]+)|(?:@[\w.-]+)/g;

type Segment =
  | { type: "text"; value: string; bold?: boolean; italic?: boolean; code?: boolean }
  | { type: "url"; value: string; href: string }
  | { type: "email"; value: string }
  | { type: "phone"; value: string }
  | { type: "mdlink"; label: string; href: string }
  | { type: "hashtag"; value: string }
  | { type: "mention"; value: string };

// Each .source is a non-capturing group, so wrapping in () gives exactly 3 numbered groups:
//   m[1] = URL, m[2] = EMAIL, m[3] = PHONE
const LINKIFY_REGEX = new RegExp(
  `(${URL_RE.source})|(${EMAIL_RE.source})|(${PHONE_RE.source})`,
  "gi"
);

function linkifyLine(line: string): Segment[] {
  const segments: Segment[] = [];
  let remaining = line;

  // 1) Replace markdown links [text](url) with placeholder
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

  // 2) Split by URL, email, phone
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
    // Determine type by the leading character — bulletproof, no group-numbering issues
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

function renderSegments(segments: Segment[], keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let i = 0;
  for (const seg of segments) {
    const k = `${keyPrefix}-${i}`;
    if (seg.type === "text") {
      let content: React.ReactNode = seg.value;
      if (seg.code) {
        content = (
          <code key={k} className="rounded bg-muted px-1 py-0.5 text-sm font-mono">
            {seg.value}
          </code>
        );
      } else if (seg.bold) {
        content = <strong key={k}>{seg.value}</strong>;
      } else if (seg.italic) {
        content = <em key={k}>{seg.value}</em>;
      } else {
        content = <Fragment key={k}>{seg.value}</Fragment>;
      }
      out.push(content);
    } else if (seg.type === "url") {
      out.push(
        <a
          key={k}
          href={seg.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline break-all text-inherit"
        >
          {seg.value}
        </a>
      );
    } else if (seg.type === "email") {
      out.push(
        <a key={k} href={`mailto:${seg.value}`} className="text-primary hover:underline break-all text-inherit">
          {seg.value}
        </a>
      );
    } else if (seg.type === "phone") {
      const tel = seg.value.replace(/\s/g, "").replace(/[().-]/g, "");
      out.push(
        <a key={k} href={`tel:${tel}`} className="text-primary hover:underline text-inherit">
          {seg.value}
        </a>
      );
    } else if (seg.type === "mdlink") {
      const isRelative = seg.href.startsWith("/") || seg.href.startsWith("#");
      if (isRelative) {
        out.push(
          <Link key={k} to={seg.href} className="text-primary hover:underline text-inherit">
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
            className="text-primary hover:underline break-all text-inherit"
          >
            {seg.label}
          </a>
        );
      }
    } else if (seg.type === "hashtag") {
      const tag = seg.value.slice(1); // strip leading #
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
      const username = seg.value.slice(1); // strip leading @
      out.push(
        <Link
          key={k}
          to={`/profile/${encodeURIComponent(username)}`}
          className="text-primary hover:underline font-medium"
        >
          {seg.value}
        </Link>
      );
    }
    i++;
  }
  return out;
}

export interface FormattedTextProps {
  /** Raw text (supports \n, \t, URLs, emails, phones, **bold**, *italic*, `code`, [text](url)) */
  text: string;
  className?: string;
}

/**
 * Renders text with:
 * - Newlines and tabs preserved (pre-wrap)
 * - URLs, emails, phone numbers linkified
 * - Basic markdown: **bold**, *italic*, `code`, [text](url)
 * No border; use for comment and description previews.
 */
export function FormattedText({ text, className }: FormattedTextProps) {
  if (!text) return null;

  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const segments = linkifyLine(lines[i]);
    const lineKey = `line-${i}`;
    const rendered = renderSegments(segments, lineKey);
    nodes.push(
      <Fragment key={lineKey}>
        {rendered.length > 0 ? rendered : <br />}
      </Fragment>
    );
    if (i < lines.length - 1) {
      nodes.push(<br key={`br-${i}`} />);
    }
  }

  return (
    <span className={cn("whitespace-pre-wrap break-words text-inherit", className)}>{nodes}</span>
  );
}
