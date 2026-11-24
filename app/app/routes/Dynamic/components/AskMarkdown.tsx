import type { ReactNode } from "react";
import { dispatchSeekTo } from "~/components/FormattedText";
import { createTimestampRegex, timestampMatchToSeconds } from "~/lib/timestamps";
import { cn } from "~/lib/utils";

/**
 * A small Markdown renderer for Ask answers. It only builds React elements, so
 * nothing the model writes can become HTML. Images are never loaded, only
 * Wikipedia links are clickable, and m:ss times become seek buttons.
 */

type Align = "left" | "center" | "right" | null;

type Block =
  | { type: "p"; text: string }
  | { type: "h"; level: number; text: string }
  | { type: "code"; lang: string; text: string }
  | { type: "quote"; blocks: Block[] }
  | { type: "list"; ordered: boolean; start: number; items: Block[][] }
  | { type: "table"; head: string[]; align: Align[]; rows: string[][] }
  | { type: "hr" };

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/;
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR_RE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE_RE = /^ {0,3}>\s?/;
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const indentOf = (line: string) => line.length - line.trimStart().length;

function isTableStart(lines: string[], i: number) {
  return lines[i].includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]);
}

function startsBlock(lines: string[], i: number) {
  const line = lines[i];
  return FENCE_RE.test(line) || HEADING_RE.test(line) || HR_RE.test(line) || QUOTE_RE.test(line) || LIST_RE.test(line) || isTableStart(lines, i);
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (s[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += s[i];
    }
  }
  cells.push(cur.trim());
  return cells;
}

function parseList(lines: string[], start: number): [Block, number] {
  const first = LIST_RE.exec(lines[start])!;
  const base = first[1].length;
  const ordered = /\d/.test(first[2]);
  const sameKind = (m: RegExpExecArray) => /\d/.test(m[2]) === ordered;
  const items: { lines: string[]; content: number }[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    const m = LIST_RE.exec(line);
    if (m && m[1].length === base && sameKind(m) && !HR_RE.test(line)) {
      items.push({ lines: [m[4]], content: base + m[2].length + Math.min(m[3].length, 4) });
      i++;
      continue;
    }
    const item = items[items.length - 1];
    if (line.trim() === "") {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      const next = j < lines.length ? LIST_RE.exec(lines[j]) : null;
      if (j < lines.length && (indentOf(lines[j]) > base || (next && next[1].length === base && sameKind(next)))) {
        item.lines.push("");
        i++;
        continue;
      }
      break;
    }
    const indent = indentOf(line);
    if (indent > base) {
      item.lines.push(line.slice(Math.min(indent, item.content)));
      i++;
      continue;
    }
    // A lazy continuation line: plain text right under an item.
    if (!m && !startsBlock(lines, i) && item.lines[item.lines.length - 1] !== "") {
      item.lines.push(line.trim());
      i++;
      continue;
    }
    break;
  }
  return [
    { type: "list", ordered, start: ordered ? Math.min(parseInt(first[2], 10) || 1, 1e6) : 1, items: items.map((it) => parseBlocks(it.lines)) },
    i,
  ];
}

function parseBlocks(lines: string[], depth = 0): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`).test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ type: "code", lang: fence[2].slice(0, 20), text: body.join("\n") });
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({ type: "h", level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }
    if (HR_RE.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }
    if (QUOTE_RE.test(line) && depth < 4) {
      const body: string[] = [];
      while (i < lines.length && lines[i].trim() !== "" && (QUOTE_RE.test(lines[i]) || !startsBlock(lines, i))) {
        body.push(lines[i].replace(QUOTE_RE, ""));
        i++;
      }
      blocks.push({ type: "quote", blocks: parseBlocks(body, depth + 1) });
      continue;
    }
    if (LIST_RE.test(line) && depth < 6) {
      const [list, next] = parseList(lines, i);
      blocks.push(list);
      i = next;
      continue;
    }
    if (isTableStart(lines, i)) {
      const head = splitRow(line);
      const align: Align[] = splitRow(lines[i + 1]).map((c) =>
        c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null,
      );
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() !== "" && lines[i].includes("|")) {
        rows.push(splitRow(lines[i]).slice(0, head.length));
        i++;
      }
      blocks.push({ type: "table", head, align, rows });
      continue;
    }
    const para: string[] = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !startsBlock(lines, i)) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: "p", text: para.join("\n") });
  }
  return blocks;
}

/** Closes markers a half streamed answer has opened, so text doesn't flash raw asterisks. */
function heal(text: string): string {
  const fences = text.split("\n").filter((l) => FENCE_RE.test(l)).length;
  if (fences % 2 === 1) return text;
  let out = text.replace(/(^|\s)(\*{1,3}|_{1,3}|~{1,2}|`{1,3})$/, "$1");
  out = out.replace(/\[([^\]\n]*)\]\([^)\s]*$/, "$1");
  const tail = out.slice(out.lastIndexOf("\n\n") + 1);
  const ticks = (tail.replace(/```/g, "").match(/`/g) || []).length;
  if (ticks % 2 === 1) return out + "`";
  if (((tail.match(/\*\*/g) || []).length) % 2 === 1) out += "**";
  if (((tail.match(/~~/g) || []).length) % 2 === 1) out += "~~";
  return out;
}

interface Ctx {
  fileId: string;
  duration?: number;
}

function withTimes(text: string, ctx: Ctx, key: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(createTimestampRegex())) {
    const seconds = timestampMatchToSeconds(m);
    const index = m.index ?? 0;
    if (ctx.duration && seconds > ctx.duration + 1) continue;
    if (index > last) nodes.push(text.slice(last, index));
    nodes.push(
      <button
        key={`${key}-t${index}`}
        type="button"
        onClick={() => dispatchSeekTo({ seconds, fileId: ctx.fileId })}
        className="rounded-sm font-medium tabular-nums text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Jump to ${m[0]}`}
      >
        {m[0]}
      </button>,
    );
    last = index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Answers link only to Wikipedia, which lookups use. Any other link, like one planted in a comment, stays plain text. */
function safeUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    const wiki = url.hostname === "wikipedia.org" || url.hostname.endsWith(".wikipedia.org");
    return url.protocol === "https:" && wiki && !url.port && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function linkNode(label: ReactNode, url: URL, plain: boolean, key: string) {
  const host = url.hostname.replace(/^www\./, "");
  return (
    <a
      key={key}
      href={url.href}
      target="_blank"
      rel="noopener noreferrer nofollow ugc"
      className="font-medium text-foreground underline decoration-border underline-offset-2 transition-colors hover:decoration-foreground"
    >
      {label}
      {/* The real destination stays visible, so a label can't pretend to be another site. */}
      {!plain && <span className="ml-1 text-xs font-normal text-muted-foreground no-underline">({host})</span>}
    </a>
  );
}

/** Index of a closing delimiter that follows a non-space character, or -1. */
function closing(text: string, delim: string, from: number): number {
  for (let at = text.indexOf(delim, from); at !== -1; at = text.indexOf(delim, at + 1)) {
    const partOfPair = delim.length === 1 && (text[at + 1] === delim || text[at - 1] === delim);
    if (at > from && !/\s/.test(text[at - 1]) && !partOfPair) return at;
  }
  return -1;
}

function inline(text: string, ctx: Ctx, key: string, depth = 0): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = "";
  let n = 0;
  const flush = () => {
    if (buf) out.push(...withTimes(buf, ctx, `${key}-${n++}`));
    buf = "";
  };
  const k = () => `${key}-${n++}`;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "\\" && next && /[\\`*_~[\]()#>|!.-]/.test(next)) {
      buf += next;
      i += 2;
      continue;
    }
    if (ch === "\n") {
      flush();
      out.push(<br key={k()} />);
      i++;
      continue;
    }
    if (ch === "`") {
      let ticks = 1;
      while (text[i + ticks] === "`") ticks++;
      const end = text.indexOf("`".repeat(ticks), i + ticks);
      if (end > i + ticks) {
        flush();
        out.push(
          <code key={k()} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">
            {text.slice(i + ticks, end).trim()}
          </code>,
        );
        i = end + ticks;
        continue;
      }
      buf += "`".repeat(ticks);
      i += ticks;
      continue;
    }
    if (depth < 6 && (ch === "*" || ch === "_" || ch === "~") && next === ch && text[i + 2] && !/\s/.test(text[i + 2])) {
      let end = closing(text, ch + ch, i + 2);
      // Bold still arriving, or cut off with the answer, runs to the end of
      // its line instead of showing raw stars. Not after a letter or digit,
      // so 2**8 stays as written.
      const unclosed = end < 0 && ch === "*" && !/\w/.test(text[i - 1] ?? "") && !text.includes("\n", i);
      if (unclosed) end = text.length;
      if (end > 0) {
        flush();
        const inner = inline(text.slice(i + 2, end), ctx, k(), depth + 1);
        out.push(
          ch === "~" ? (
            <del key={k()} className="text-muted-foreground">{inner}</del>
          ) : (
            <strong key={k()} className="font-semibold text-foreground">{inner}</strong>
          ),
        );
        i = unclosed ? end : end + 2;
        continue;
      }
    }
    if (depth < 6 && (ch === "*" || ch === "_") && next && !/\s/.test(next) && next !== ch && !(ch === "_" && /\w/.test(text[i - 1] ?? ""))) {
      const end = closing(text, ch, i + 1);
      if (end > 0 && !(ch === "_" && /\w/.test(text[end + 1] ?? ""))) {
        flush();
        out.push(<em key={k()}>{inline(text.slice(i + 1, end), ctx, k(), depth + 1)}</em>);
        i = end + 1;
        continue;
      }
    }
    if (ch === "[" || (ch === "!" && next === "[")) {
      const image = ch === "!";
      const m = /^\[([^\]\n]{1,300})\]\(\s*<?([^\s)>]{1,2000})>?(?:\s+"[^"\n]*")?\s*\)/.exec(text.slice(image ? i + 1 : i));
      if (m) {
        flush();
        const url = safeUrl(m[2]);
        // Images are never loaded; their alt text stands in.
        const label = inline(m[1], ctx, k(), depth + 1);
        out.push(url && !image ? linkNode(label, url, m[1].includes(url.hostname), k()) : <span key={k()}>{label}</span>);
        i += m[0].length + (image ? 1 : 0);
        continue;
      }
    }
    if (ch === "h" && (text.startsWith("https://", i) || text.startsWith("http://", i)) && !/\w/.test(text[i - 1] ?? "")) {
      const m = /^https?:\/\/[^\s<>]{1,2000}/.exec(text.slice(i));
      const raw = m ? m[0].replace(/[.,;:!?'")\]]+$/, "") : "";
      const url = raw ? safeUrl(raw) : null;
      if (url) {
        flush();
        out.push(linkNode(raw, url, true, k()));
        i += raw.length;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

const alignClass = (a: Align) => (a === "center" ? "text-center" : a === "right" ? "text-right" : "text-left");

function renderBlocks(blocks: Block[], ctx: Ctx, key: string, tail?: ReactNode, tight = false): ReactNode[] {
  return blocks.map((b, idx) => {
    const k = `${key}-${idx}`;
    const end = idx === blocks.length - 1 ? tail : null;
    switch (b.type) {
      case "p":
        return tight ? (
          <span key={k}>
            {inline(b.text, ctx, k)}
            {end}
          </span>
        ) : (
          <p key={k}>
            {inline(b.text, ctx, k)}
            {end}
          </p>
        );
      case "h": {
        const cls = cn("font-semibold tracking-tight text-foreground", b.level <= 2 ? "text-base" : "text-sm");
        const content = (
          <>
            {inline(b.text, ctx, k)}
            {end}
          </>
        );
        return b.level <= 2 ? (
          <h3 key={k} className={cls}>{content}</h3>
        ) : (
          <h4 key={k} className={cls}>{content}</h4>
        );
      }
      case "code":
        return (
          <div key={k} className="overflow-hidden rounded-lg border border-border/70 bg-muted/60">
            {b.lang && (
              <div className="border-b border-border/70 px-3 py-1 font-mono text-[11px] text-muted-foreground">{b.lang}</div>
            )}
            <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[13px] leading-relaxed text-foreground">
              <code>
                {b.text}
                {end}
              </code>
            </pre>
          </div>
        );
      case "quote":
        return (
          <blockquote key={k} className="space-y-2 border-l-2 border-border pl-3 text-muted-foreground">
            {renderBlocks(b.blocks, ctx, k, end)}
          </blockquote>
        );
      case "list": {
        const items = b.items.map((item, j) => {
          const single = item.length === 1 && item[0].type === "p";
          return (
            <li key={`${k}-${j}`} className="pl-1 [&>*+*]:mt-1.5">
              {renderBlocks(item, ctx, `${k}-${j}`, j === b.items.length - 1 ? end : null, single)}
            </li>
          );
        });
        const cls = "space-y-1.5 pl-5 marker:text-muted-foreground";
        return b.ordered ? (
          <ol key={k} start={b.start} className={cn("list-decimal", cls)}>{items}</ol>
        ) : (
          <ul key={k} className={cn("list-disc", cls)}>{items}</ul>
        );
      }
      case "table":
        return (
          <div key={k}>
            <div className="overflow-x-auto rounded-lg border border-border/70">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-muted/60">
                  <tr>
                    {b.head.map((cell, j) => (
                      <th key={j} className={cn("px-3 py-1.5 font-medium text-foreground", alignClass(b.align[j] ?? null))}>
                        {inline(cell, ctx, `${k}-h${j}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((row, r) => (
                    <tr key={r} className="border-t border-border/70">
                      {b.head.map((_, j) => (
                        <td key={j} className={cn("px-3 py-1.5 align-top", alignClass(b.align[j] ?? null))}>
                          {inline(row[j] ?? "", ctx, `${k}-${r}-${j}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {end}
          </div>
        );
      case "hr":
        return (
          <div key={k}>
            <hr className="border-border/70" />
            {end}
          </div>
        );
    }
  });
}

interface AskMarkdownProps {
  text: string;
  fileId: string;
  duration?: number;
  /** True while the answer is still arriving. */
  streaming?: boolean;
  /** Placed at the end of the last line, for the typing caret. */
  tail?: ReactNode;
  className?: string;
}

export default function AskMarkdown({ text, fileId, duration, streaming, tail, className }: AskMarkdownProps) {
  const source = streaming ? heal(text) : text;
  const blocks = parseBlocks(source.replace(/\r\n?/g, "\n").split("\n"));
  return (
    <div className={cn("space-y-3 break-words text-sm leading-relaxed text-foreground", className)}>
      {blocks.length > 0 ? renderBlocks(blocks, { fileId, duration }, "md", tail) : tail}
    </div>
  );
}
