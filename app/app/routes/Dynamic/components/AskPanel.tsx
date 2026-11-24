import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ArrowUp, BookOpen, Check, Copy, Hourglass, MessageCircleQuestionMark, Search, Square, SquarePen, X } from "lucide-react";
import { motion, AnimatePresence, useDragControls, useReducedMotion } from "framer-motion";
import { useCloseOnTimestampSeek } from "~/lib/hooks/useCloseOnTimestampSeek";
import { signedFetch } from "~/lib/Security/requestSigning.client";
import { ASK_MESSAGES, askMessage } from "~/lib/askMessages";
import { cn } from "~/lib/utils";
import AskMarkdown from "./AskMarkdown";

const MAX_QUESTION = 500;
const MAX_ANSWER_CHARS = 6000;
const MAX_SOURCES = 5;
const CHAT_ID_RE = /^[a-f0-9]{32}$/;
const SOURCE_HOST = "en.wikipedia.org";
const FALLBACK_ERROR = "Something went wrong. Try again.";
const CUT_NOTE = "Cut short. Ask about the part you need.";
const MAX_WAIT_SECONDS = 120;
// When it's busy the question is sent again by itself this many times.
const BUSY_RETRIES = 2;

/** A failure written here, so its message is safe to show. Any other error shows FALLBACK_ERROR. */
class AskError extends Error {}

/** The model's line is full; retry is how many seconds until it is worth asking again. */
class BusyError extends AskError {
  constructor(readonly retry: number) {
    super(BusyError.isLong(retry) ? ASK_MESSAGES.later : `${ASK_MESSAGES.busy} Try again in ${retry}s.`);
  }

  /** The server caps its wait here, so the real one may be far longer, like Ask's daily share running out. */
  static isLong(retry: number) {
    return retry >= MAX_WAIT_SECONDS;
  }
}

const waitSeconds = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_WAIT_SECONDS ? value : null;

/** Waits out a busy spell, ticking each second, unless the viewer stops it. */
function countdown(seconds: number, signal: AbortSignal, onTick: (left: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let left = seconds;
    onTick(left);
    const timer = setInterval(() => {
      left -= 1;
      if (left > 0) return onTick(left);
      clearInterval(timer);
      resolve();
    }, 1000);
    signal.addEventListener(
      "abort",
      () => {
        clearInterval(timer);
        reject(new DOMException("Stopped", "AbortError"));
      },
      { once: true },
    );
  });
}
// The reel rail's Ask button uses the same id, so closing returns focus there too.
const LAUNCHER_ATTR = "data-ask-launcher";
const DOCK_ID = "ask-dock";

const SUGGESTIONS = ["Summarize this video", "What is said in it?", "What are the key moments?"];

const EASE = [0.2, 0, 0, 1] as const;
const SPRING = { type: "spring", stiffness: 380, damping: 34, mass: 0.9 } as const;
// The user bubble's corners: rounded, with a small tail corner bottom right.
const BUBBLE_RADIUS = "18px 18px 6px 18px";
const BUBBLE_PAD_X = 14;
const BUBBLE_PAD_Y = 8;
const BUBBLE_FONT_PX = 14;

type Source = { title: string; url: string };

type Turn = {
  id: number;
  role: "user" | "assistant";
  content: string;
  /** Still arriving from the server. */
  live?: boolean;
  /** Why the answer ended early, shown under it. */
  note?: string;
  /** The Wikipedia lookup running now, then the one that ran. */
  searching?: string;
  searched?: string;
  sources?: Source[];
  /** A user bubble hidden while its text flies in from the composer. */
  landing?: boolean;
  /** Waiting in line for the model: the expected seconds and when that was said. */
  queued?: { seconds: number; at: number };
};

type Rect = { left: number; top: number; width: number; height: number };

/** A sent question on its way from the composer (or a suggestion) to its bubble. */
type Flight = {
  id: number;
  text: string;
  from: Rect;
  to: Rect | null;
  /** Text offset and size where it started, so it lifts straight off the field. */
  textX: number;
  textY: number;
  scale: number;
  fromChip: boolean;
};

interface AskPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileId: string;
  uniqueId: string;
  duration?: number;
  /** On wide screens, sit inside the parent (a side dock) instead of floating. */
  docked?: boolean;
}

function rectOf(el: Element | null): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function useWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return wide;
}

/**
 * How far the on-screen keyboard (and the browser panning to make room for it)
 * pushes in the visible area, so the sheet can sit just above the keyboard.
 */
function useKeyboardInsets(active: boolean): { top: number; bottom: number } {
  const [insets, setInsets] = useState({ top: 0, bottom: 0 });
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) return;
    const sync = () => {
      const top = Math.max(0, Math.round(vv.offsetTop));
      const bottom = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      setInsets((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      setInsets({ top: 0, bottom: 0 });
    };
  }, [active]);
  return insets;
}

/** Reveals streamed text a few characters per frame, so bursts read as typing. */
function useSmoothText(text: string, live: boolean): string {
  const reduce = useReducedMotion();
  const [count, setCount] = useState(() => (live ? 0 : text.length));
  const textRef = useRef(text);
  textRef.current = text;
  const behind = count < text.length;

  useEffect(() => {
    if (reduce || (!live && !behind)) return;
    let raf = 0;
    const tick = () => {
      setCount((prev) => {
        const t = textRef.current;
        if (prev >= t.length) return prev;
        let next = Math.min(t.length, prev + Math.max(2, Math.ceil((t.length - prev) / 8)));
        const code = t.charCodeAt(next - 1);
        if (code >= 0xd800 && code <= 0xdbff && next < t.length) next++;
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live, behind, reduce]);

  return reduce ? text : text.slice(0, count);
}

function readSource(raw: unknown): Source | null {
  if (!raw || typeof raw !== "object") return null;
  const { title, url } = raw as Record<string, unknown>;
  if (typeof title !== "string" || !title.trim() || title.length > 200 || typeof url !== "string") return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.hostname !== SOURCE_HOST || u.username || u.password) return null;
    return { title: title.trim(), url: u.toString() };
  } catch {
    return null;
  }
}

type StreamHandlers = {
  onChat: (id: string) => void;
  onWait: (seconds: number) => void;
  onSearch: (query: string) => void;
  onSources: (sources: Source[]) => void;
  onText: (text: string) => void;
  onCut: () => void;
};

/** Reads the answer stream: one JSON event per line, ending in "done" or "err". */
async function readAnswer(res: Response, on: StreamHandlers): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) throw new AskError(FALLBACK_ERROR);
  const decoder = new TextDecoder();
  let buffer = "";
  let total = 0;
  let finished = false;
  // The server closes the stream right after "done", so read to the end
  // rather than cancelling, which would show as an aborted request.
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      if (finished) return;
      throw new AskError("The answer stopped early. Try again.");
    }
    if (finished) continue;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while (!finished && (nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      let ev: { t?: unknown; v?: unknown; n?: unknown; retry?: unknown; sources?: unknown };
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.t === "done") finished = true;
      else if (ev.t === "cut") on.onCut();
      else if (ev.t === "err") {
        const retry = waitSeconds(ev.retry);
        throw retry ? new BusyError(retry) : new AskError(askMessage(ev.v) ?? FALLBACK_ERROR);
      } else if (ev.t === "c" && typeof ev.v === "string" && CHAT_ID_RE.test(ev.v)) on.onChat(ev.v);
      else if (ev.t === "w") {
        const secs = waitSeconds(ev.n);
        if (secs) on.onWait(secs);
      }
      else if (ev.t === "s" && typeof ev.v === "string") on.onSearch(ev.v.slice(0, 200));
      else if (ev.t === "r" && Array.isArray(ev.sources)) {
        const list = ev.sources.slice(0, MAX_SOURCES).map(readSource).filter((s): s is Source => !!s);
        if (list.length) on.onSources(list);
      } else if (ev.t === "d" && typeof ev.v === "string") {
        total += ev.v.length;
        if (total > MAX_ANSWER_CHARS) {
          on.onCut();
          void reader.cancel().catch(() => {});
          return;
        }
        on.onText(ev.v);
      }
    }
  }
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          // Clipboard can be blocked; nothing useful to tell the viewer.
        }
      }}
      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={copied ? "Copied" : "Copy answer"}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={copied ? "done" : "copy"}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.6, opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="flex"
        >
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

function Dots() {
  return (
    <div className="flex h-5 items-center gap-1" role="status" aria-label="Answering">
      {[0, 1, 2].map((d) => (
        <motion.span
          key={d}
          className="size-1.5 rounded-full bg-muted-foreground/70"
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: d * 0.16, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

/** Seconds left of a wait the server guessed, never shown below one. */
function useSecondsLeft(seconds: number, at: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(1, Math.ceil(seconds - (now - at) / 1000));
}

function WaitLine({ text }: { text: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      role="status"
      className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
    >
      <Hourglass className="size-3.5 shrink-0" aria-hidden />
      <motion.span
        className="truncate"
        animate={{ opacity: [0.55, 1, 0.55] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      >
        {text}
      </motion.span>
    </motion.div>
  );
}

function QueueLine({ seconds, at }: { seconds: number; at: number }) {
  const left = useSecondsLeft(seconds, at);
  return <WaitLine text={`Lots of people are asking. You're in line, about ${left}s`} />;
}

function LookupLine({ query, active }: { query: string; active: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-2 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
    >
      <Search className="size-3.5 shrink-0" aria-hidden />
      <motion.span
        className="truncate"
        animate={active ? { opacity: [0.55, 1, 0.55] } : { opacity: 1 }}
        transition={active ? { duration: 1.4, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
      >
        {active ? "Looking up" : "Looked up"} “{query}” on Wikipedia
      </motion.span>
    </motion.div>
  );
}

function Answer({ turn, fileId, duration }: { turn: Turn; fileId: string; duration?: number }) {
  const shown = useSmoothText(turn.content, !!turn.live);
  const typing = !!turn.live || shown.length < turn.content.length;
  const lookup = turn.searching ?? turn.searched;
  const caret = typing ? (
    <span
      aria-hidden
      className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[0.2em] animate-pulse rounded-full bg-foreground/70"
    />
  ) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: EASE }}
      className="w-full min-w-0 self-start"
    >
      {lookup && <LookupLine query={lookup} active={!!turn.searching} />}
      {!turn.content && turn.live ? (
        turn.queued ? (
          <QueueLine seconds={turn.queued.seconds} at={turn.queued.at} />
        ) : (
          !turn.searching && <Dots />
        )
      ) : (
        <AskMarkdown text={shown} fileId={fileId} duration={duration} streaming={typing} tail={caret} />
      )}
      {!typing && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
          {turn.sources && turn.sources.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {turn.sources.map((s) => (
                <a
                  key={s.url}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow ugc"
                  aria-label={`${s.title} on Wikipedia, opens in a new tab`}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted/70 px-2.5 py-1 text-xs text-foreground/80 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <BookOpen className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{s.title}</span>
                </a>
              ))}
            </div>
          )}
          <div className="mt-1 flex items-center gap-2">
            {turn.content && <CopyButton text={turn.content} />}
            {turn.note && <span className="text-xs text-muted-foreground">{turn.note}</span>}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

/**
 * The question lifting off the composer and settling into its bubble: the
 * text glides to where the bubble's text sits while the bubble's fill grows
 * around it, and the text color crosses over to the bubble's.
 */
function Ghost({ flight, onLanded }: { flight: Flight & { to: Rect }; onLanded: () => void }) {
  const { from, to } = flight;
  // Same four corner values on both ends, so the corners morph rather than jump.
  const r0 = flight.fromChip ? from.height / 2 : 12;
  return createPortal(
    <motion.div
      aria-hidden
      className="pointer-events-none fixed z-[calc(var(--z-comment-dock)+1)] max-lg:z-[var(--z-ask-sheet)]"
      style={{ left: to.left, top: to.top }}
      initial={{ x: from.left - to.left, y: from.top - to.top, width: from.width, height: from.height }}
      animate={{ x: 0, y: 0, width: to.width, height: to.height }}
      transition={SPRING}
      onAnimationComplete={onLanded}
    >
      <motion.div
        className="absolute inset-0 bg-primary"
        initial={{ opacity: flight.fromChip ? 0.35 : 0, borderRadius: `${r0}px ${r0}px ${r0}px ${r0}px` }}
        animate={{ opacity: 1, borderRadius: BUBBLE_RADIUS }}
        transition={{ duration: 0.3, ease: EASE }}
      />
      <motion.div
        className="absolute origin-top-left whitespace-pre-wrap break-words text-sm leading-5"
        style={{ width: to.width - BUBBLE_PAD_X * 2 }}
        initial={{ x: flight.textX, y: flight.textY, scale: flight.scale }}
        animate={{ x: BUBBLE_PAD_X, y: BUBBLE_PAD_Y, scale: 1 }}
        transition={SPRING}
      >
        <motion.span
          className="absolute inset-0 text-foreground"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: EASE }}
        >
          {flight.text}
        </motion.span>
        <motion.span
          className="relative text-primary-foreground"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25, ease: EASE }}
        >
          {flight.text}
        </motion.span>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

/** The card on the page that opens the chat. */
export function AskLauncher({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      {...{ [LAUNCHER_ATTR]: "" }}
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={DOCK_ID}
      className={cn(
        "group flex w-full items-center gap-3 rounded-xl border border-border/70 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-lg:rounded-lg",
        open ? "bg-muted" : "bg-background hover:bg-muted/50",
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors",
          open ? "bg-background" : "bg-muted",
        )}
      >
        <MessageCircleQuestionMark className="size-4 text-foreground/80" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">Ask about this video</span>
        <span className="block truncate text-xs text-muted-foreground">
          {open ? "The chat is open" : "Get a summary or ask what happens, answered from the video itself"}
        </span>
      </span>
      <span className="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
        {open ? "Close" : "Ask"}
      </span>
    </button>
  );
}

/**
 * The chat itself, floating at the side on wide screens (or filling a side
 * dock when docked) and as a sheet over the whole page on phones. It is mounted
 * once per video and keeps the chat while closed, so layout changes and
 * resizes never reset it.
 */
export default function AskPanel({ open, onOpenChange, fileId, uniqueId, duration, docked = false }: AskPanelProps) {
  const reduce = useReducedMotion();
  const wide = useWide();
  const inline = docked && wide;
  const sheet = open && !wide;
  const keyboard = useKeyboardInsets(sheet);
  const drag = useDragControls();
  const dockRef = useRef<HTMLElement>(null);
  const [mounted, setMounted] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [retryIn, setRetryIn] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const chatRef = useRef<string | null>(null);
  const nextId = useRef(0);
  const stickRef = useRef(true);
  const hasTurns = turns.length > 0;

  useEffect(() => setMounted(true), []);
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!open) {
      setFlight(null);
      setTurns((prev) => (prev.some((t) => t.landing) ? prev.map((t) => ({ ...t, landing: false })) : prev));
      return;
    }
    // On a phone the field would pull the keyboard up, so focus the sheet instead.
    requestAnimationFrame(() => (wide ? inputRef.current : dockRef.current)?.focus({ preventScroll: true }));
  }, [open, wide]);

  // The phone sheet covers the player, so a tapped time steps it aside to show the jump.
  const closeForSeek = useCallback(() => onOpenChange(false), [onOpenChange]);
  useCloseOnTimestampSeek(sheet, closeForSeek, fileId);

  // Follow the answer as it types out, unless the viewer scrolled up to read.
  useEffect(() => {
    const list = listRef.current;
    const content = contentRef.current;
    if (!open || !list || !content || typeof ResizeObserver === "undefined") return;
    list.scrollTop = list.scrollHeight;
    const ro = new ResizeObserver(() => {
      if (stickRef.current) list.scrollTop = list.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [open, hasTurns]);

  // Find where the new bubble sits, then let the ghost fly there before paint.
  useLayoutEffect(() => {
    if (!flight || flight.to) return;
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
    const to = rectOf(list?.querySelector(`[data-turn="${flight.id}"]`) ?? null);
    if (!to) {
      setFlight(null);
      setTurns((prev) => prev.map((t) => (t.id === flight.id ? { ...t, landing: false } : t)));
      return;
    }
    setFlight({ ...flight, to });
  }, [flight]);

  function land(id: number) {
    setFlight((f) => (f?.id === id ? null : f));
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, landing: false } : t)));
  }

  function close() {
    onOpenChange(false);
    // A page can hold more than one launcher (reels keep hidden copies), so focus the one on screen.
    [...document.querySelectorAll<HTMLElement>(`[${LAUNCHER_ATTR}]`)]
      .find((el) => el.getClientRects().length > 0)
      ?.focus({ preventScroll: true });
  }

  function newChat() {
    // Dropping the controller first tells the old answer it no longer owns the chat.
    const old = abortRef.current;
    abortRef.current = null;
    old?.abort();
    setPending(false);
    setRetryIn(null);
    chatRef.current = null;
    setTurns([]);
    setFlight(null);
    setError(null);
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }

  function updateLast(change: (t: Turn) => Turn) {
    setTurns((prev) => {
      const last = prev[prev.length - 1];
      return last?.role === "assistant" ? [...prev.slice(0, -1), change(last)] : prev;
    });
  }

  async function ask(question: string, chip?: HTMLElement | null) {
    const q = question.trim().slice(0, MAX_QUESTION);
    if (!q || pending) return;
    const id = ++nextId.current;
    const origin = chip ?? inputRef.current;
    const from = reduce ? null : rectOf(origin);
    if (from && origin) {
      const style = getComputedStyle(origin);
      const fontPx = parseFloat(style.fontSize) || BUBBLE_FONT_PX;
      setFlight({
        id,
        text: q,
        from,
        to: null,
        textX: parseFloat(style.paddingLeft) || 0,
        textY: parseFloat(style.paddingTop) || 0,
        scale: fontPx / BUBBLE_FONT_PX,
        fromChip: !!chip,
      });
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const current = () => abortRef.current === controller;
    const update = (change: (t: Turn) => Turn) => {
      if (current()) updateLast(change);
    };
    stickRef.current = true;
    setTurns((prev) => [...prev, { id, role: "user", content: q, landing: !!from }]);
    setDraft("");
    setError(null);
    setPending(true);

    let received = "";
    // A question that never got an answer leaves no chat behind on the server.
    const priorChat = chatRef.current;
    const attempt = async () => {
      const res = await signedFetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uniqueId, question: q, ...(chatRef.current ? { conversationId: chatRef.current } : {}) }),
        signal: controller.signal,
      });
      if (!res.ok || !(res.headers.get("content-type") || "").includes("application/x-ndjson")) {
        const json = (await res.json().catch(() => null)) as { error?: unknown; retryAfter?: unknown } | null;
        const retry = res.status === 503 ? waitSeconds(json?.retryAfter) : null;
        if (retry) throw new BusyError(retry);
        throw new AskError(askMessage(json?.error) ?? FALLBACK_ERROR);
      }
      if (!current()) return;
      setTurns((prev) => [...prev, { id: ++nextId.current, role: "assistant", content: "", live: true }]);
      await readAnswer(res, {
        onChat: (chat) => {
          if (current()) chatRef.current = chat;
        },
        onWait: (seconds) => update((t) => ({ ...t, queued: { seconds, at: Date.now() } })),
        onSearch: (query) => update((t) => ({ ...t, searching: query, queued: undefined })),
        onSources: (sources) =>
          update((t) => ({
            ...t,
            searched: t.searching ?? t.searched,
            searching: undefined,
            sources: [...(t.sources ?? []), ...sources].slice(0, MAX_SOURCES),
          })),
        onText: (text) => {
          received += text;
          update((t) => ({
            ...t,
            content: t.content + text,
            searched: t.searching ?? t.searched,
            searching: undefined,
            queued: undefined,
          }));
        },
        onCut: () => update((t) => ({ ...t, note: CUT_NOTE })),
      });
    };
    try {
      for (let tries = 0; ; tries++) {
        try {
          await attempt();
          break;
        } catch (e) {
          if (!(e instanceof BusyError) || BusyError.isLong(e.retry) || received || tries >= BUSY_RETRIES || !current()) throw e;
          // Nothing came back yet, so wait it out and send the same question again.
          chatRef.current = priorChat;
          setTurns((prev) => (prev[prev.length - 1]?.role === "assistant" ? prev.slice(0, -1) : prev));
          // A little spread, so everyone told the same wait doesn't come back at once.
          await countdown(e.retry + Math.floor(Math.random() * 3), controller.signal, (left) => {
            if (current()) setRetryIn(left);
          });
          if (current()) setRetryIn(null);
        }
      }
      update((t) => ({ ...t, live: false, searched: t.searching ?? t.searched, searching: undefined, queued: undefined }));
    } catch (e) {
      // A new chat started meanwhile; this answer has nowhere to go.
      if (!current()) return;
      setRetryIn(null);
      const stopped = controller.signal.aborted;
      if (received) {
        update((t) => ({
          ...t,
          live: false,
          searching: undefined,
          queued: undefined,
          note: stopped ? "Stopped" : "The answer stopped early.",
        }));
      } else {
        // Nothing arrived, so put the question back for another try.
        chatRef.current = priorChat;
        setTurns((prev) => {
          const out = prev[prev.length - 1]?.role === "assistant" ? prev.slice(0, -1) : prev;
          return out[out.length - 1]?.id === id ? out.slice(0, -1) : out;
        });
        setFlight((f) => (f?.id === id ? null : f));
        setDraft(q);
        if (!stopped) setError(e instanceof AskError && e.message ? e.message : FALLBACK_ERROR);
      }
    } finally {
      if (current()) {
        abortRef.current = null;
        setPending(false);
      }
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending) abortRef.current?.abort();
    else void ask(draft);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void ask(draft);
    }
  }

  // While a question is in flight the reply waits, so the bubble it aims
  // for doesn't move under it.
  const flying = flight !== null;
  const shownTurns = flying ? turns.filter((t) => t.role === "user" || t.id < flight.id) : turns;
  const waiting = pending && !flying && turns[turns.length - 1]?.role === "user";

  if (!mounted) return null;

  const panel = (
    <AnimatePresence>
        {sheet && (
          <motion.div
            key="ask-backdrop"
            aria-hidden
            className="fixed inset-0 z-[var(--z-ask-sheet)] bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
            onClick={close}
          />
        )}
        {open && (
          <motion.aside
            key="ask-dock"
            ref={dockRef}
            id={DOCK_ID}
            role={wide ? undefined : "dialog"}
            aria-modal={wide ? undefined : true}
            aria-label="Ask about this video"
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                close();
              }
            }}
            drag={wide ? false : "y"}
            dragListener={false}
            dragControls={drag}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 1 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || (info.offset.y > 48 && info.velocity.y > 600)) close();
            }}
            initial={reduce || inline ? { opacity: 0 } : wide ? { opacity: 0, x: 28, scale: 0.98 } : { y: "100%" }}
            animate={reduce || inline ? { opacity: 1 } : wide ? { opacity: 1, x: 0, scale: 1 } : { y: 0 }}
            exit={reduce || inline ? { opacity: 0 } : wide ? { opacity: 0, x: 28, scale: 0.98 } : { y: "100%" }}
            transition={reduce || inline ? { duration: 0.15 } : SPRING}
            style={
              wide ? undefined : ({ "--kb-top": `${keyboard.top}px`, "--kb-bottom": `${keyboard.bottom}px` } as CSSProperties)
            }
            className={cn(
              "flex flex-col overflow-hidden outline-none",
              inline
                ? "h-full min-h-0 w-full bg-background text-foreground"
                : [
                    "fixed bg-popover text-popover-foreground shadow-2xl",
                    "inset-x-0 z-[var(--z-ask-sheet)] mx-auto max-w-2xl rounded-t-2xl border-t border-border sm:border-x",
                    "top-[calc(env(safe-area-inset-top)+0.75rem+var(--kb-top,0px))] bottom-[var(--kb-bottom,0px)]",
                    "lg:inset-x-auto lg:right-4 lg:bottom-4 lg:top-[calc(var(--app-top-nav-h,3.5rem)+0.75rem)] lg:z-[var(--z-comment-dock)] lg:mx-0 lg:w-[400px] lg:max-w-none lg:origin-right lg:rounded-2xl lg:border",
                  ],
            )}
          >
            <header
              onPointerDown={(e) => {
                if (!wide && !(e.target as Element).closest("button")) drag.start(e);
              }}
              className="relative flex shrink-0 items-center gap-2.5 border-b border-border/60 py-2.5 pl-3.5 pr-2 max-lg:touch-none max-lg:pt-5"
            >
              <span
                aria-hidden
                className="absolute left-1/2 top-2 h-1 w-9 -translate-x-1/2 rounded-full bg-muted-foreground/30 lg:hidden"
              />
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                <MessageCircleQuestionMark className="size-4 text-foreground/80" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold leading-tight text-foreground">Ask</h2>
                <p className="truncate text-xs text-muted-foreground">About this video</p>
              </div>
              <AnimatePresence initial={false}>
                {hasTurns && (
                  <motion.div
                    key="new"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.15 }}
                  >
                    <IconButton label="New chat" onClick={newChat}>
                      <SquarePen className="size-4" aria-hidden />
                    </IconButton>
                  </motion.div>
                )}
              </AnimatePresence>
              <IconButton label="Close" onClick={close}>
                <X className="size-4" aria-hidden />
              </IconButton>
            </header>

            <div
              ref={listRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
              }}
              className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3.5 [scrollbar-width:thin]"
              aria-live="polite"
              aria-busy={pending}
            >
              <div ref={contentRef} className="flex flex-1 flex-col gap-4 py-4">
                {hasTurns ? (
                  <>
                    {shownTurns.map((t) =>
                      t.role === "user" ? (
                        <div
                          key={t.id}
                          data-turn={t.id}
                          className={cn(
                            "max-w-[85%] self-end bg-primary px-3.5 py-2 text-sm leading-5 text-primary-foreground",
                            t.landing && "invisible",
                          )}
                          style={{ borderRadius: BUBBLE_RADIUS }}
                        >
                          <span className="whitespace-pre-wrap break-words">{t.content}</span>
                        </div>
                      ) : (
                        <Answer key={t.id} turn={t} fileId={fileId} duration={duration} />
                      ),
                    )}
                    {retryIn !== null ? (
                      <WaitLine text={`Lots of people are asking right now. Asking again in ${retryIn}s`} />
                    ) : (
                      waiting && <Dots />
                    )}
                  </>
                ) : (
                  <div className="mt-auto flex flex-col gap-4">
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, ease: EASE }}
                    >
                      <p className="text-[15px] font-medium text-foreground">Ask anything about this video</p>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        Answers come from its captions, frames and details. Facts about songs and topics come from
                        Wikipedia.
                      </p>
                    </motion.div>
                    <div className="flex flex-col items-start gap-2">
                      {SUGGESTIONS.map((s, i) => (
                        <motion.button
                          key={s}
                          type="button"
                          disabled={pending}
                          onClick={(e) => void ask(s, e.currentTarget)}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.3, ease: EASE, delay: 0.08 + i * 0.05 }}
                          whileTap={reduce ? undefined : { scale: 0.97 }}
                          className="rounded-full border border-border bg-background px-3.5 py-1.5 text-xs text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {s}
                        </motion.button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div
              className={cn(
                "shrink-0 px-3 pb-3 pt-1",
                keyboard.bottom === 0 && "max-lg:pb-[max(0.75rem,env(safe-area-inset-bottom))]",
              )}
            >
              <AnimatePresence initial={false}>
                {error && (
                  <motion.p
                    key="err"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="px-1 pb-2 text-xs text-destructive"
                    role="alert"
                  >
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>
              <form
                onSubmit={onSubmit}
                className="flex items-end gap-2 rounded-2xl border border-input bg-background py-1.5 pl-3.5 pr-1.5 transition-shadow focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40 dark:bg-input/30"
              >
                <textarea
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.slice(0, MAX_QUESTION))}
                  onKeyDown={onKeyDown}
                  rows={1}
                  maxLength={MAX_QUESTION}
                  placeholder="Ask a question"
                  aria-label="Your question"
                  className="field-sizing-content max-h-32 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-base leading-5 outline-none placeholder:text-muted-foreground md:text-sm"
                />
                <motion.button
                  type="submit"
                  whileTap={reduce ? undefined : { scale: 0.88 }}
                  disabled={!pending && !draft.trim()}
                  aria-label={pending ? "Stop answering" : "Send question"}
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                >
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                      key={pending ? "stop" : "send"}
                      initial={{ scale: 0.5, opacity: 0, rotate: pending ? -45 : 45 }}
                      animate={{ scale: 1, opacity: 1, rotate: 0 }}
                      exit={{ scale: 0.5, opacity: 0 }}
                      transition={{ duration: 0.18, ease: EASE }}
                      className="flex"
                    >
                      {pending ? <Square className="size-3 fill-current" aria-hidden /> : <ArrowUp className="size-4" aria-hidden />}
                    </motion.span>
                  </AnimatePresence>
                </motion.button>
              </form>
              <p className="mt-2 px-1 text-[11px] leading-snug text-muted-foreground">
                Answers can be wrong. Chats are kept for 30 minutes.
              </p>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
  );

  return (
    <>
      {inline ? panel : createPortal(panel, document.body)}
      {open && flight?.to && <Ghost flight={flight as Flight & { to: Rect }} onLanded={() => land(flight.id)} />}
    </>
  );
}
