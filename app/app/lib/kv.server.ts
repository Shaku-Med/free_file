import { createHash } from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import { requireSecret } from "~/lib/Security/secretEnv.server";

/**
 * Shared state for rate limits and one time tokens, so every copy of the app
 * sees the same counts. Redis in production (REDIS_URL plus REDIS_PASSWORD);
 * `REDIS_URL=memory://` keeps it inside this process and is refused when
 * NODE_ENV is production.
 *
 * Every function throws when the store can't answer. Callers treat that as
 * "not allowed", never as a free pass.
 *
 * Speaks the Redis wire protocol directly over one socket instead of pulling
 * in a client library: the app only needs a handful of commands.
 */

const PREFIX = "app:";
const COMMAND_TIMEOUT_MS = 1500;
const CONNECT_TIMEOUT_MS = 2000;
const RETRY_AFTER_FAIL_MS = 1000;

export type WindowHit = { count: number; resetMs: number; blockedMs: number };

interface Store {
  hit(countKey: string, blockKey: string, windowMs: number): Promise<WindowHit>;
  claim(key: string, ttlMs: number): Promise<boolean>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  del(keys: string[]): Promise<void>;
}

/** Short stable id for a user supplied value (email, IP, token) so raw values never sit in the store. */
export function digest(value: string): string {
  return createHash("sha256").update(value).digest("base64url").slice(0, 32);
}

class ReplyError extends Error {}

type Reply = string | number | null | ReplyError | Reply[];
type Arg = string | number;

function encode(args: Arg[]): Buffer {
  let out = `*${args.length}\r\n`;
  for (const a of args) {
    const s = String(a);
    out += `$${Buffer.byteLength(s)}\r\n${s}\r\n`;
  }
  return Buffer.from(out);
}

/** Parses one reply starting at `at`; null when the buffer doesn't hold all of it yet. */
function parse(buf: Buffer, at: number): [Reply, number] | null {
  const end = buf.indexOf("\r\n", at);
  if (end < 0) return null;
  const line = buf.toString("utf8", at + 1, end);
  const next = end + 2;
  switch (buf[at]) {
    case 0x2b: // +
      return [line, next];
    case 0x2d: // -
      return [new ReplyError(line), next];
    case 0x3a: // :
      return [Number(line), next];
    case 0x24: { // $
      const len = Number(line);
      if (len < 0) return [null, next];
      if (buf.length < next + len + 2) return null;
      return [buf.toString("utf8", next, next + len), next + len + 2];
    }
    case 0x2a: { // *
      const n = Number(line);
      if (n < 0) return [null, next];
      const items: Reply[] = [];
      let pos = next;
      for (let i = 0; i < n; i++) {
        const r = parse(buf, pos);
        if (!r) return null;
        items.push(r[0]);
        pos = r[1];
      }
      return [items, pos];
    }
    default:
      throw new Error("unexpected reply from store");
  }
}

type Pending = { resolve: (r: Reply) => void; reject: (e: Error) => void };

class RedisStore implements Store {
  private socket: net.Socket | null = null;
  private ready: Promise<void> | null = null;
  private pending: Pending[] = [];
  private buf: Buffer = Buffer.alloc(0);
  private failedAt = 0;

  constructor(
    private readonly url: URL,
    private readonly username: string,
    private readonly password: string,
  ) {}

  private drop(err: Error) {
    const waiting = this.pending;
    this.pending = [];
    this.socket = null;
    this.ready = null;
    this.buf = Buffer.alloc(0);
    this.failedAt = Date.now();
    for (const p of waiting) p.reject(err);
  }

  private onData(socket: net.Socket, chunk: Buffer) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    let at = 0;
    try {
      for (;;) {
        if (at >= this.buf.length) break;
        const r = parse(this.buf, at);
        if (!r) break;
        at = r[1];
        const p = this.pending.shift();
        if (!p) throw new Error("reply without a request");
        p.resolve(r[0]);
      }
    } catch (e) {
      socket.destroy(e as Error);
      return;
    }
    this.buf = at >= this.buf.length ? Buffer.alloc(0) : this.buf.subarray(at);
  }

  private write(args: Arg[]): Promise<Reply> {
    const socket = this.socket;
    if (!socket || socket.destroyed) return Promise.reject(new Error("store connection closed"));
    return new Promise((resolve, reject) => {
      // A late reply would land on the wrong request, so a timeout ends the connection.
      const timer = setTimeout(() => socket.destroy(new Error("store timeout")), COMMAND_TIMEOUT_MS);
      this.pending.push({
        resolve: (r) => {
          clearTimeout(timer);
          if (r instanceof ReplyError) reject(r);
          else resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      socket.write(encode(args));
    });
  }

  private open(): Promise<void> {
    if (this.ready) return this.ready;
    if (Date.now() - this.failedAt < RETRY_AFTER_FAIL_MS) {
      return Promise.reject(new Error("store unavailable"));
    }
    const secure = this.url.protocol === "rediss:";
    const host = this.url.hostname;
    const port = Number(this.url.port) || 6379;
    const db = this.url.pathname.replace(/^\//, "");

    const ready = new Promise<void>((resolve, reject) => {
      const socket = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
      this.socket = socket;
      this.buf = Buffer.alloc(0);
      socket.setNoDelay(true);
      socket.setKeepAlive(true, 30_000);
      const timer = setTimeout(() => socket.destroy(new Error("store connect timeout")), CONNECT_TIMEOUT_MS);
      socket.on("data", (chunk: Buffer) => this.onData(socket, chunk));
      socket.on("error", () => {});
      socket.on("close", () => {
        clearTimeout(timer);
        const err = new Error("store connection closed");
        if (this.socket === socket) this.drop(err);
        reject(err);
      });
      socket.once(secure ? "secureConnect" : "connect", () => {
        clearTimeout(timer);
        const hello: Promise<Reply>[] = [];
        if (this.password) {
          hello.push(this.write(this.username ? ["AUTH", this.username, this.password] : ["AUTH", this.password]));
        }
        if (db) hello.push(this.write(["SELECT", db]));
        Promise.all(hello).then(
          () => resolve(),
          (e: Error) => {
            socket.destroy(e);
            reject(e);
          },
        );
      });
    });
    this.ready = ready;
    return ready;
  }

  private async command(args: Arg[]): Promise<Reply> {
    await this.open();
    return this.write(args);
  }

  private async transaction(cmds: Arg[][]): Promise<Reply[]> {
    await this.open();
    const sent = [this.write(["MULTI"]), ...cmds.map((c) => this.write(c)), this.write(["EXEC"])];
    const replies = await Promise.all(sent);
    const results = replies[replies.length - 1];
    if (!Array.isArray(results)) throw new Error("store transaction failed");
    for (const r of results) if (r instanceof ReplyError) throw r;
    return results;
  }

  async hit(countKey: string, blockKey: string, windowMs: number): Promise<WindowHit> {
    // SET NX starts the window with its expiry, INCR keeps it; MULTI makes the
    // three steps one, so a window can never lose its expiry.
    const [blockTtl, , count, countTtl] = await this.transaction([
      ["PTTL", blockKey],
      ["SET", countKey, "0", "PX", windowMs, "NX"],
      ["INCR", countKey],
      ["PTTL", countKey],
    ]);
    return {
      count: Number(count),
      resetMs: Number(countTtl) > 0 ? Number(countTtl) : windowMs,
      blockedMs: Number(blockTtl) > 0 ? Number(blockTtl) : 0,
    };
  }

  async claim(key: string, ttlMs: number): Promise<boolean> {
    return (await this.command(["SET", key, "1", "PX", ttlMs, "NX"])) === "OK";
  }

  async get(key: string): Promise<string | null> {
    const r = await this.command(["GET", key]);
    return typeof r === "string" ? r : null;
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    await this.command(["SET", key, value, "PX", ttlMs]);
  }

  async del(keys: string[]): Promise<void> {
    if (keys.length) await this.command(["DEL", ...keys]);
  }
}

/** Local dev only. Same behaviour as RedisStore, held in this process. */
class MemoryStore implements Store {
  private items = new Map<string, { value: string; expiresAt: number }>();

  constructor() {
    setInterval(() => {
      const now = Date.now();
      for (const [k, v] of this.items) if (v.expiresAt <= now) this.items.delete(k);
    }, 60_000).unref();
  }

  private live(key: string) {
    const item = this.items.get(key);
    if (!item) return null;
    if (item.expiresAt <= Date.now()) {
      this.items.delete(key);
      return null;
    }
    return item;
  }

  async hit(countKey: string, blockKey: string, windowMs: number): Promise<WindowHit> {
    const now = Date.now();
    const block = this.live(blockKey);
    const item = this.live(countKey) ?? { value: "0", expiresAt: now + windowMs };
    item.value = String(Number(item.value) + 1);
    this.items.set(countKey, item);
    return {
      count: Number(item.value),
      resetMs: item.expiresAt - now,
      blockedMs: block ? block.expiresAt - now : 0,
    };
  }

  async claim(key: string, ttlMs: number): Promise<boolean> {
    if (this.live(key)) return false;
    this.items.set(key, { value: "1", expiresAt: Date.now() + ttlMs });
    return true;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    this.items.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  async del(keys: string[]): Promise<void> {
    for (const k of keys) this.items.delete(k);
  }
}

function makeStore(): Store {
  const production = process.env.NODE_ENV === "production";
  const raw = (process.env.REDIS_URL ?? "").trim();
  if (!raw) throw new Error("REDIS_URL is not set");
  if (raw === "memory://") {
    if (production) throw new Error("REDIS_URL=memory:// is for local dev only");
    console.warn("[kv] REDIS_URL=memory:// keeps rate limits in this process only. Dev use only.");
    return new MemoryStore();
  }
  const url = new URL(raw);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL must start with redis:// or rediss://");
  }
  if (url.pathname.length > 1 && !/^\/\d{1,2}$/.test(url.pathname)) {
    throw new Error("REDIS_URL database must be a number");
  }
  const password = production
    ? requireSecret("REDIS_PASSWORD", process.env.REDIS_PASSWORD, decodeURIComponent(url.password))
    : process.env.REDIS_PASSWORD || decodeURIComponent(url.password);
  return new RedisStore(url, decodeURIComponent(url.username), password);
}

let store: Store | null = null;
let configError: Error | null = null;

function getStore(): Store {
  if (store) return store;
  if (configError) throw configError;
  try {
    store = makeStore();
    return store;
  } catch (e) {
    configError = e instanceof Error ? e : new Error(String(e));
    console.error("[kv] store not configured:", configError.message);
    throw configError;
  }
}

function key(name: string): string {
  return PREFIX + name;
}

function positiveMs(ms: number): number {
  return Math.max(1, Math.floor(ms));
}

/** Counts one hit in a fixed window and reports any block set on `blockName`. */
export function hitWindow(countName: string, blockName: string, windowMs: number): Promise<WindowHit> {
  return getStore().hit(key(countName), key(blockName), positiveMs(windowMs));
}

/** True the first time `name` is claimed until it expires; false for every repeat. */
export function claimOnce(name: string, ttlMs: number): Promise<boolean> {
  return getStore().claim(key(name), positiveMs(ttlMs));
}

export function getValue(name: string): Promise<string | null> {
  return getStore().get(key(name));
}

export function setValue(name: string, value: string, ttlMs: number): Promise<void> {
  return getStore().set(key(name), value, positiveMs(ttlMs));
}

export function clearKeys(...names: string[]): Promise<void> {
  return getStore().del(names.map(key));
}
