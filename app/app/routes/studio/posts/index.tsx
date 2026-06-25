import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type { MetaFunction } from "react-router";
import { buildPageMeta } from "~/lib/seo";
import { cn } from "~/lib/utils";
import { formatNumber } from "~/lib/utils/formatNumber";
import VideoCard, { requestVideoCardEdit } from "~/routes/Home/components/VideoCard";
import Actions from "~/routes/Home/components/VideoCard/Actions";
import type { FileType } from "~/lib/types";
import { invalidateStudioCache, useStudioData } from "~/lib/studio/studioCache";
import {
  ArrowUpDown,
  ChevronDown,
  Globe,
  Loader2,
  Lock,
  Search,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { useFileContext } from "~/lib/Context/Context";

export const meta: MetaFunction = () =>
  buildPageMeta({
    title: "Studio Posts | Memories",
    description: "Manage your uploads from Brozy Studio.",
    canonicalPath: "/brozystudio/posts",
  });

interface PostRow {
  id: string;
  unique_id: string;
  filename: string;
  file_title?: string | null;
  file_type: string;
  endpoint: string;
  duration?: number | null;
  created_at: string;
  view_count?: number | null;
  like_count?: number | null;
  comment_count?: number | null;
  is_public?: boolean | null;
  is_adult?: boolean | null;
  is_reel?: boolean | null;
  upload_status?: string | null;
  processing_progress?: number | null;
  default_thumbnail?: string | null;
  thumbnails?: string[] | null;
}

type StatusFilter = "all" | "public" | "private" | "adult" | "processing";
type SortKey = "newest" | "oldest" | "views";

const STATUS_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "public", label: "Public" },
  { key: "private", label: "Private" },
  { key: "adult", label: "Adult flagged" },
  { key: "processing", label: "Processing" },
];

const PAGE_SIZE = 24;

function PrivacyChip({
  post,
  onChange,
}: {
  post: PostRow;
  onChange: (isPublic: boolean) => void;
}) {
  const isPublic = post.is_public !== false;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2 py-1 text-xs text-foreground transition-colors hover:bg-muted/40"
        >
          {isPublic ? <Globe className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
          <span>{isPublic ? "Everyone" : "Private"}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        <DropdownMenuItem onSelect={() => onChange(true)} className="gap-2">
          <Globe className="h-3.5 w-3.5" /> Everyone
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onChange(false)} className="gap-2">
          <Lock className="h-3.5 w-3.5" /> Only me
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SortHeader({
  label,
  active,
  onToggle,
}: {
  label: string;
  active?: boolean;
  onToggle?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wide transition-colors",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      {onToggle && <ArrowUpDown className="h-3 w-3" />}
    </button>
  );
}

function PostStats({
  views,
  likes,
  comments,
  inline = false,
}: {
  views: number;
  likes: number;
  comments: number;
  inline?: boolean;
}) {
  const itemClass = inline
    ? "text-xs tabular-nums text-muted-foreground sm:text-sm"
    : "text-sm tabular-nums text-foreground";
  const valueClass = inline ? "font-medium text-foreground" : "";

  if (inline) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={itemClass}>
          <span className={valueClass}>{formatNumber(views)}</span> views
        </span>
        <span className={itemClass}>
          <span className={valueClass}>{formatNumber(likes)}</span> likes
        </span>
        <span className={itemClass}>
          <span className={valueClass}>{formatNumber(comments)}</span> comments
        </span>
      </div>
    );
  }

  return (
    <>
      <div className={itemClass}>{formatNumber(views)}</div>
      <div className={itemClass}>{formatNumber(likes)}</div>
      <div className={itemClass}>{formatNumber(comments)}</div>
    </>
  );
}

function StudioPostRow({
  post,
  userId,
  onPrivacyChange,
  onEdit,
  onDelete,
  onUpdate,
}: {
  post: PostRow;
  userId: string | null | undefined;
  onPrivacyChange: (isPublic: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onUpdate: (fileId: string, updates: Partial<FileType>) => void;
}) {
  const fileData = { ...post, owner_id: userId ?? undefined } as unknown as FileType;

  // A still-processing upload can't be deleted (the worker may be mid-write).
  // Hide the delete action; the server also blocks it as the real safeguard.
  const isProcessing =
    typeof post.upload_status === "string" &&
    ["queued", "running", "processing", "pending", "uploading"].includes(
      post.upload_status.toLowerCase(),
    );

  const renderActions = () => (
    <Actions
      fileId={post.id}
      uniqueId={post.unique_id}
      likeCount={post.like_count ?? 0}
      dislikeCount={0}
      commentCount={post.comment_count ?? 0}
      liked={false}
      disliked={false}
      isOwner={true}
      isAdult={Boolean(post.is_adult)}
      currentUserId={userId ?? null}
      fileOwnerId={userId ?? undefined}
      fileCreatedAt={post.created_at}
      commentsEnabled={true}
      layout="shortsShelf"
      onEdit={onEdit}
      onDelete={isProcessing ? undefined : onDelete}
    />
  );

  return (
    <li className="border-b border-border/50 px-3 py-3 transition-colors last:border-b-0 hover:bg-muted/15 sm:px-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(100px,130px)_repeat(3,minmax(56px,72px))_minmax(88px,120px)] lg:items-center lg:gap-3 lg:px-4 lg:py-3">
      <div className="flex min-w-0 items-start gap-2 lg:contents">
        <div className="min-w-0 flex-1">
          <VideoCard
            layout="studioRow"
            data={fileData}
            currentUserId={userId ?? undefined}
            onUpdate={onUpdate}
          />
        </div>
        <div className="shrink-0 pt-0.5 lg:hidden">{renderActions()}</div>
      </div>

      <div className="mt-3 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 lg:mt-0 lg:contents">
        <div className="lg:px-1">
          <PrivacyChip post={post} onChange={onPrivacyChange} />
        </div>

        <div className="lg:hidden">
          <PostStats
            inline
            views={post.view_count ?? 0}
            likes={post.like_count ?? 0}
            comments={post.comment_count ?? 0}
          />
        </div>

        <div className="hidden lg:contents">
          <PostStats
            views={post.view_count ?? 0}
            likes={post.like_count ?? 0}
            comments={post.comment_count ?? 0}
          />
        </div>

        <div className="hidden items-center justify-end lg:flex">{renderActions()}</div>
      </div>
    </li>
  );
}

export default function StudioPostsPage() {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);

  const cacheKey = `studio:posts:${status}:${sort}:${offset}`;
  const url = `/api/studio/posts?${new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(offset),
    status,
    sort,
  }).toString()}`;
  const { data: raw, loading, error: err, refresh } = useStudioData<{
    success: boolean;
    data: PostRow[];
    pagination: { total: number; hasMore: boolean };
  }>({
    cacheKey,
    url,
    ttlMs: 60_000,
  });

  // Mirror cached rows into local state so privacy toggle / edit / delete
  // can mutate optimistically without waiting for a refetch.
  const [rows, setRows] = useState<PostRow[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    if (!raw) return;
    setRows(raw.data ?? []);
    setTotal(raw.pagination?.total ?? 0);
    setHasMore(Boolean(raw.pagination?.hasMore));
  }, [raw]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const t = (r.file_title ?? r.filename ?? "").toLowerCase();
      return t.includes(q);
    });
  }, [rows, search]);

  const { userId } = useFileContext();
  const [pendingDelete, setPendingDelete] = useState<PostRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Email-code "sudo" step shown when the server asks for delete verification.
  const [verifyStep, setVerifyStep] = useState<"sending" | "code" | null>(null);
  const [verifyCodeInput, setVerifyCodeInput] = useState("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (verifyStep !== "code" || resendIn <= 0) return;
    const id = window.setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [verifyStep, resendIn]);

  const closeDeleteModal = () => {
    setPendingDelete(null);
    setVerifyStep(null);
    setVerifyCodeInput("");
    setVerifyError(null);
    setVerifyBusy(false);
    setResendIn(0);
  };

  const sendVerifyCode = async (): Promise<boolean> => {
    setVerifyError(null);
    try {
      const res = await fetch("/api/studio/delete-verify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "send" }),
      });
      if (res.status === 429) {
        setVerifyError("Too many codes requested. Try again later.");
        return false;
      }
      if (!res.ok) {
        setVerifyError("Couldn't send the code. Try again.");
        return false;
      }
      setResendIn(60);
      return true;
    } catch {
      setVerifyError("Couldn't send the code. Try again.");
      return false;
    }
  };

  const startVerification = async () => {
    setVerifyStep("sending");
    const ok = await sendVerifyCode();
    setVerifyStep(ok ? "code" : null);
    if (!ok) setVerifyError((e) => e ?? "Couldn't send the code. Try again.");
  };

  const togglePrivacy = async (post: PostRow, nextIsPublic: boolean) => {
    if (post.is_public === nextIsPublic) return;
    setBusyId(post.id);
    setRows((prev) => prev.map((r) => (r.id === post.id ? { ...r, is_public: nextIsPublic } : r)));
    try {
      const res = await fetch("/api/studio/post/update", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unique_id: post.unique_id, is_public: nextIsPublic }),
      });
      if (!res.ok) {
        setRows((prev) => prev.map((r) => (r.id === post.id ? { ...r, is_public: post.is_public } : r)));
      } else {
        invalidateStudioCache("studio:posts:");
        invalidateStudioCache("studio:overview");
      }
    } catch {
      setRows((prev) => prev.map((r) => (r.id === post.id ? { ...r, is_public: post.is_public } : r)));
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    const target = pendingDelete;
    if (!target) return;
    setBusyId(target.id);
    setVerifyError(null);
    try {
      const res = await fetch("/api/studio/post/delete", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unique_id: target.unique_id }),
      });
      if (res.ok) {
        setRows((prev) => prev.filter((r) => r.id !== target.id));
        setTotal((t) => Math.max(0, t - 1));
        invalidateStudioCache("studio:");
        closeDeleteModal();
        return;
      }
      if (res.status === 401) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        if (data?.error === "verification_required") {
          // Keep the modal open and switch to the email-code step.
          await startVerification();
          return;
        }
      }
      if (res.status === 409) {
        // Still processing  the worker may be mid-write; surface why.
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        setVerifyError(data?.message ?? "This video is still processing. You can delete it once it finishes.");
        return;
      }
      setVerifyError("Couldn't delete right now. Try again.");
    } catch {
      setVerifyError("Couldn't delete right now. Try again.");
    } finally {
      setBusyId(null);
    }
  };

  const submitVerifyCode = async () => {
    const code = verifyCodeInput.trim();
    if (!/^\d{6}$/.test(code)) {
      setVerifyError("Enter the 6-digit code from your email.");
      return;
    }
    setVerifyBusy(true);
    setVerifyError(null);
    try {
      const res = await fetch("/api/studio/delete-verify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "verify", code }),
      });
      if (!res.ok) {
        setVerifyError(
          res.status === 429
            ? "Too many tries. Wait a bit and try again."
            : "Wrong or expired code. Check your email and try again.",
        );
        return;
      }
      // Verified  the sudo cookie is set; run the delete for real.
      setVerifyStep(null);
      setVerifyCodeInput("");
      await confirmDelete();
    } catch {
      setVerifyError("Something went wrong. Try again.");
    } finally {
      setVerifyBusy(false);
    }
  };

  const cycleSort = (k: "views" | "likes" | "comments" | "date") => {
    if (k === "views") setSort("views");
    else if (k === "date") setSort((p) => (p === "newest" ? "oldest" : "newest"));
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-baseline gap-4 border-b border-border/60">
        <button
          type="button"
          className="border-b-2 border-primary pb-2 text-sm font-semibold text-foreground"
        >
          Posts <span className="text-muted-foreground">{total}</span>
        </button>
        <Link
          to="/brozystudio/posts?status=processing"
          className="pb-2 text-sm font-medium text-muted-foreground/70 hover:text-foreground"
        >
          Drafts 0
        </Link>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <select
          value={status}
          onChange={(e) => {
            setOffset(0);
            setStatus(e.target.value as StatusFilter);
          }}
          className="w-full rounded-md border border-border/60 bg-card/40 px-3 py-2 text-sm text-foreground sm:w-auto sm:py-1.5"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>

        <div className="flex w-full items-center gap-2 rounded-md border border-border/60 bg-card/40 px-3 py-2 sm:ml-auto sm:max-w-md sm:py-1.5">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search posts"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Could not load your posts. Try refreshing.
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border/60 bg-card/30">
        <div className="hidden border-b border-border/60 bg-muted/20 px-4 py-2.5 text-muted-foreground lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(100px,130px)_repeat(3,minmax(56px,72px))_minmax(88px,120px)] lg:items-center lg:gap-3">
          <SortHeader label="Posts (Created on)" onToggle={() => cycleSort("date")} active={sort === "newest" || sort === "oldest"} />
          <span className="text-xs font-medium uppercase tracking-wide">Privacy</span>
          <SortHeader label="Views" onToggle={() => cycleSort("views")} active={sort === "views"} />
          <span className="text-xs font-medium uppercase tracking-wide">Likes</span>
          <span className="text-xs font-medium uppercase tracking-wide">Comments</span>
          <span className="text-right text-xs font-medium uppercase tracking-wide">Actions</span>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 px-4 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            No posts match this view.
          </div>
        ) : (
          <ul>
            {filtered.map((p) => (
              <StudioPostRow
                key={p.id}
                post={p}
                userId={userId}
                onPrivacyChange={(v) => togglePrivacy(p, v)}
                onEdit={() => requestVideoCardEdit(p.unique_id)}
                onDelete={() => setPendingDelete(p)}
                onUpdate={(fileId, updates) => {
                  setRows((prev) =>
                    prev.map((r) => (r.id === fileId ? { ...r, ...updates } : r)),
                  );
                  invalidateStudioCache("studio:posts:");
                }}
              />
            ))}
          </ul>
        )}
      </div>

      <Dialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) closeDeleteModal();
        }}
      >
        <DialogContent className="sm:max-w-sm">
          {verifyStep === null ? (
            <>
              <DialogHeader>
                <DialogTitle>Delete this post forever?</DialogTitle>
                <DialogDescription>
                  Everything will be gone: the video and its stored files, likes, comments, and
                  analytics. There are{" "}
                  <span className="font-semibold text-foreground">no backups</span>  this cannot
                  be undone.
                </DialogDescription>
              </DialogHeader>
              {verifyError && <p className="text-sm text-destructive">{verifyError}</p>}
              <DialogFooter>
                <button
                  type="button"
                  onClick={closeDeleteModal}
                  disabled={busyId === pendingDelete?.id}
                  className="rounded-md border border-border/60 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDelete}
                  disabled={busyId === pendingDelete?.id}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                >
                  {pendingDelete && busyId === pendingDelete.id && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  Yes, delete
                </button>
              </DialogFooter>
            </>
          ) : verifyStep === "sending" ? (
            <>
              <DialogHeader>
                <DialogTitle>Verify it&apos;s you</DialogTitle>
                <DialogDescription>Sending a code to your email…</DialogDescription>
              </DialogHeader>
              <div className="flex items-center justify-center py-4 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Verify it&apos;s you</DialogTitle>
                <DialogDescription>
                  We emailed you a 6-digit code (expires in 20 minutes). Enter it to confirm the
                  delete. You won&apos;t be asked again for a couple of hours.
                </DialogDescription>
              </DialogHeader>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={verifyCodeInput}
                onChange={(e) => setVerifyCodeInput(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !verifyBusy) void submitVerifyCode();
                }}
                placeholder="000000"
                className="w-full rounded-md border border-border/60 bg-card/40 px-3 py-2 text-center font-mono text-lg tracking-[0.4em] text-foreground outline-none focus:border-primary"
                autoFocus
              />
              {verifyError && <p className="text-sm text-destructive">{verifyError}</p>}
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => void sendVerifyCode()}
                  disabled={resendIn > 0 || verifyBusy}
                  className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={closeDeleteModal}
                    disabled={verifyBusy}
                    className="rounded-md border border-border/60 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void submitVerifyCode()}
                    disabled={verifyBusy || verifyCodeInput.length !== 6}
                    className="inline-flex items-center justify-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                  >
                    {verifyBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Verify &amp; delete
                  </button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {!loading && total > PAGE_SIZE && (
        <div className="flex flex-col gap-2 pt-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            Showing {offset + 1} to {Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              disabled={offset === 0}
              className="rounded-md border border-border/60 px-2.5 py-1 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              disabled={!hasMore}
              className="rounded-md border border-border/60 px-2.5 py-1 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
