import { useState, useCallback, useEffect, useRef } from "react";
import type React from "react";
import { useLocation } from "react-router";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Input } from "~/components/ui/input";
import { Send, X, Loader2, Search, ImagePlus, Camera, ChevronDown } from "lucide-react";
import { isMobile } from "react-device-detect";
import { useFileContext } from "~/lib/Context/Context";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "~/components/ui/dialog";
import { Avatar, AvatarImage, AvatarFallback } from "~/components/ui/avatar";
import { getProfilePicUrl } from "~/lib/utils/profilePic";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

export interface CommentGif {
  id: string;
  url: string;
  previewUrl: string;
}

export interface CommentImage {
  url: string;
  type: string;
  previewUrl?: string;
}

interface TagSuggestion {
  tag: string;
  count: number;
}

interface MentionSuggestion {
  id: string;
  username: string;
  profile_pic: string;
}

const MAX_COMMENT_IMAGE_BYTES = 10 * 1024 * 1024;

interface CommentFormProps {
  fileId: string;
  parentId?: string | null;
  onSubmit: (content: string, gif?: CommentGif | null, image?: CommentImage | null) => Promise<void>;
  onCancel?: () => void;
  placeholder?: string;
  /** When set on a reply form, the textarea is pre-filled with `@username `. */
  replyToUsername?: string | null;
}

const SUGGEST_DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 1;
const MAX_SUGGESTIONS = 10;

function parseTrigger(text: string, cursor: number): { type: "tag" | "mention"; query: string; start: number } | null {
  const before = text.slice(0, cursor);
  const atIdx = before.lastIndexOf("@");
  const hashIdx = before.lastIndexOf("#");
  const lastAt = atIdx >= 0 ? atIdx : -1;
  const lastHash = hashIdx >= 0 ? hashIdx : -1;
  const last = Math.max(lastAt, lastHash);
  if (last === -1) return null;
  const afterTrigger = text.slice(last + 1, cursor);
  if (/\s/.test(afterTrigger)) return null;
  const match = /^[\w.-]*/.exec(text.slice(last + 1));
  const query = (match ? match[0] : "").toLowerCase();
  if (last === lastAt) return { type: "mention", query, start: last };
  return { type: "tag", query, start: last };
}

const CommentForm = ({
  fileId,
  parentId,
  onSubmit,
  onCancel,
  placeholder,
  replyToUsername,
}: CommentFormProps) => {
  const location = useLocation();
  const { userProfile, altAccounts } = useFileContext();
  const [switchingAccountId, setSwitchingAccountId] = useState<string | null>(null);
  const commentAsName = userProfile?.username?.trim() || "User";
  const hasOtherAccounts = altAccounts.length > 0;

  const switchToAccount = useCallback(
    async (userId: string) => {
      const returnTo = `${location.pathname}${location.search}${location.hash}`;
      setSwitchingAccountId(userId);
      try {
        const res = await fetch("/api/auth/switch-account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ userId }),
        });
        if (res.ok) window.location.assign(returnTo);
      } finally {
        setSwitchingAccountId(null);
      }
    },
    [location.hash, location.pathname, location.search]
  );
  const resolvedPlaceholder =
    placeholder ?? (parentId ? "Write a reply…" : `Comment as ${commentAsName}`);
  /** Reply forms open with `@username ` already typed; user just keeps typing. */
  const initialContent = parentId && replyToUsername ? `@${replyToUsername} ` : "";
  const [content, setContent] = useState(initialContent);
  /** Keep the @-mention seeded if the form is reused for a different parent. */
  useEffect(() => {
    if (parentId && replyToUsername) {
      setContent((prev) => (prev.length === 0 ? `@${replyToUsername} ` : prev));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only seed on parentId change
  }, [parentId, replyToUsername]);
  const [gif, setGif] = useState<CommentGif | null>(null);
  const [image, setImage] = useState<CommentImage | null>(null);
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [gifQuery, setGifQuery] = useState("");
  const [gifResults, setGifResults] = useState<CommentGif[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [gifError, setGifError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  /** Mobile-only: opens camera via `capture` (see hidden input below). */
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const cursorRef = useRef(0);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestType, setSuggestType] = useState<"tag" | "mention">("tag");
  const [suggestQuery, setSuggestQuery] = useState("");
  const [tagSuggestions, setTagSuggestions] = useState<TagSuggestion[]>([]);
  const [mentionSuggestions, setMentionSuggestions] = useState<MentionSuggestion[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(0);
  const suggestStartRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchGifs = useCallback(async (query: string, isTrending: boolean) => {
    setGifLoading(true);
    setGifError(null);
    try {
      const params = new URLSearchParams({ limit: "24" });
      if (isTrending) {
        params.set("trending", "1");
      } else {
        params.set("q", query);
      }
      const res = await fetch(`/api/gif-search?${params.toString()}`);
      const data = await res.json();
      setGifResults(Array.isArray(data.results) ? data.results : []);
      if (data.error) setGifError(data.error);
    } catch {
      setGifResults([]);
      setGifError("Could not load GIFs");
    } finally {
      setGifLoading(false);
    }
  }, []);

  useEffect(() => {
    if (gifOpen) {
      fetchGifs("", true);
    }
  }, [gifOpen, fetchGifs]);

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (imageInputRef.current) imageInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";

    if (!file.type.startsWith("image/")) {
      setImageError("Please select an image file");
      return;
    }
    if (file.size > MAX_COMMENT_IMAGE_BYTES) {
      setImageError("Image must be under 10MB");
      return;
    }

    setImageError(null);
    setPendingImageFile(file);
    setImage(null);
    const localPreview = URL.createObjectURL(file);
    setImagePreview(localPreview);
    setGif(null);
  }, []);

  const uploadImage = useCallback(async (file: File): Promise<CommentImage> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("file_id", fileId);

    const res = await fetch("/api/upload/comment-image", {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error || "Upload failed");
    }
    return { url: json.image.url, type: json.image.type };
  }, [fileId]);

  const searchGifs = useCallback(() => {
    const trimmed = gifQuery.trim();
    if (trimmed) {
      fetchGifs(trimmed, false);
    } else {
      fetchGifs("", true);
    }
  }, [gifQuery, fetchGifs]);

  const fetchTagSuggestions = useCallback(async (q: string) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setSuggestLoading(true);
    setTagSuggestions([]);
    try {
      const params = new URLSearchParams({ limit: String(MAX_SUGGESTIONS) });
      if (q.length >= MIN_QUERY_LEN) params.set("q", q);
      const res = await fetch(`/api/tags?${params}`, { signal: abortRef.current.signal });
      const data = await res.json();
      setTagSuggestions(Array.isArray(data.results) ? data.results : []);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setTagSuggestions([]);
    } finally {
      setSuggestLoading(false);
    }
  }, []);

  const fetchMentionSuggestions = useCallback(async (q: string) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setSuggestLoading(true);
    setMentionSuggestions([]);
    try {
      if (q.length < MIN_QUERY_LEN) {
        setMentionSuggestions([]);
        setSuggestLoading(false);
        return;
      }
      const res = await fetch(`/api/mentions?q=${encodeURIComponent(q)}&limit=${MAX_SUGGESTIONS}`, {
        signal: abortRef.current.signal,
      });
      const data = await res.json();
      setMentionSuggestions(Array.isArray(data.results) ? data.results : []);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setMentionSuggestions([]);
    } finally {
      setSuggestLoading(false);
    }
  }, []);

  const applySuggestion = useCallback(
    (replaceWith: string) => {
      const start = suggestStartRef.current;
      const textarea = textareaRef.current;
      if (!textarea) return;
      const before = content.slice(0, start);
      const after = content.slice(cursorRef.current);
      const next = before + replaceWith + " " + after;
      setContent(next);
      setSuggestOpen(false);
      setTagSuggestions([]);
      setMentionSuggestions([]);
      requestAnimationFrame(() => {
        textarea.focus();
        const pos = start + replaceWith.length + 1;
        textarea.setSelectionRange(pos, pos);
        cursorRef.current = pos;
      });
    },
    [content]
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const cursor = textareaRef.current?.selectionStart ?? content.length;
    cursorRef.current = cursor;
    const parsed = parseTrigger(content, cursor);
    if (!parsed) {
      setSuggestOpen(false);
      setTagSuggestions([]);
      setMentionSuggestions([]);
      return;
    }
    suggestStartRef.current = parsed.start;
    setSuggestType(parsed.type);
    setSuggestQuery(parsed.query);
    setSuggestOpen(true);
    setSuggestIndex(0);

    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      if (parsed.type === "tag") {
        fetchTagSuggestions(parsed.query);
      } else {
        fetchMentionSuggestions(parsed.query);
      }
    }, SUGGEST_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [content, fetchTagSuggestions, fetchMentionSuggestions]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const hasText = content.trim().length > 0;
    const hasGif = gif != null;
    const hasPendingImg = pendingImageFile != null;
    if ((!hasText && !hasGif && !hasPendingImg) || isSubmitting) return;

    setIsSubmitting(true);
    setImageError(null);
    try {
      // Upload the image now (at submit time), not before
      let uploadedImage: CommentImage | null | undefined = undefined;
      if (pendingImageFile) {
        setIsUploadingImage(true);
        try {
          uploadedImage = await uploadImage(pendingImageFile);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Image upload failed";
          setImageError(msg);
          setIsUploadingImage(false);
          setIsSubmitting(false);
          return;
        }
        setIsUploadingImage(false);
      }

      await onSubmit(content.trim(), gif || undefined, uploadedImage || undefined);
      setContent("");
      setGif(null);
      setImage(null);
      setPendingImageFile(null);
      setImagePreview(null);
      setImageError(null);
    } catch (error) {
      console.error("Error submitting comment:", error);
    } finally {
      setIsSubmitting(false);
      setIsUploadingImage(false);
    }
  };

  const canSubmit = (content.trim().length > 0 || gif != null || pendingImageFile != null) && !isSubmitting;

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        {gif && (
          <div className="relative inline-flex w-fit rounded-lg overflow-hidden">
            <img
              src={gif.previewUrl}
              alt="Selected GIF"
              className="h-24 w-auto max-w-full object-contain rounded-lg"
            />
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="absolute right-1 top-1 h-6 w-6 rounded-full shadow-sm bg-black/60 hover:bg-black/80 text-white"
              onClick={() => setGif(null)}
              aria-label="Remove GIF"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
        {imagePreview && (
          <div className="relative inline-flex w-fit rounded-lg overflow-hidden">
            <img
              src={imagePreview}
              alt="Selected image"
              className="h-24 w-auto max-w-full object-contain rounded-lg"
            />
            {isUploadingImage && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-lg">
                <Loader2 className="h-5 w-5 animate-spin text-white" />
              </div>
            )}
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="absolute right-1 top-1 h-6 w-6 rounded-full shadow-sm bg-black/60 hover:bg-black/80 text-white"
              onClick={() => { setImage(null); setPendingImageFile(null); setImagePreview(null); setImageError(null); }}
              disabled={isUploadingImage}
              aria-label="Remove image"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
        {imageError && (
          <p className="text-xs text-destructive">{imageError}</p>
        )}
        <div className="flex items-start gap-3">
          <div className="relative shrink-0">
            {hasOtherAccounts ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="relative rounded-full outline-none ring-offset-background transition-[box-shadow] focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    aria-label="Switch account to comment as"
                    disabled={Boolean(switchingAccountId)}
                  >
                    <Avatar className="h-10 w-10 ring-2 ring-background">
                      <AvatarImage src={getProfilePicUrl(userProfile?.profile_pic)} alt={commentAsName} />
                      <AvatarFallback className="text-sm font-medium">
                        {commentAsName.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span
                      className="pointer-events-none absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground shadow-sm"
                      aria-hidden
                    >
                      <ChevronDown className="h-2.5 w-2.5" strokeWidth={2.5} />
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    Comment as another account
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {altAccounts.map((a) => (
                    <DropdownMenuItem
                      key={a.id}
                      className="flex cursor-pointer items-center gap-2.5"
                      disabled={switchingAccountId !== null}
                      onSelect={(e) => {
                        e.preventDefault();
                        void switchToAccount(a.id);
                      }}
                    >
                      <Avatar className="h-7 w-7 shrink-0 ring-1 ring-border">
                        <AvatarImage src={getProfilePicUrl(a.profile_pic ?? undefined)} alt="" />
                        <AvatarFallback className="text-[10px] font-medium">
                          {a.username.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 truncate">
                        {switchingAccountId === a.id ? "Switching…" : a.username}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Avatar className="h-10 w-10 ring-2 ring-background">
                <AvatarImage src={getProfilePicUrl(userProfile?.profile_pic)} alt={commentAsName} />
                <AvatarFallback className="text-sm font-medium">
                  {commentAsName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            )}
          </div>
          <div className="min-w-0 flex-1 rounded-[22px] border border-border/60 bg-muted/60 shadow-inner dark:bg-muted/50">
            <div className="relative px-4 pt-3 pb-1">
              <Textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  cursorRef.current = e.target.selectionStart ?? 0;
                }}
                onSelect={(e) => {
                  cursorRef.current = (e.target as HTMLTextAreaElement).selectionStart ?? 0;
                }}
                onKeyDown={(e) => {
                  if (!suggestOpen) return;
                  const list = suggestType === "tag" ? tagSuggestions : mentionSuggestions;
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSuggestIndex((i) => (i + 1) % Math.max(1, list.length));
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSuggestIndex((i) => (list.length ? (i - 1 + list.length) % list.length : 0));
                    return;
                  }
                  if (e.key === "Enter" && list.length > 0) {
                    e.preventDefault();
                    if (suggestType === "tag") {
                      const item = tagSuggestions[suggestIndex];
                      if (item) applySuggestion(`#${item.tag}`);
                    } else {
                      const item = mentionSuggestions[suggestIndex];
                      if (item) applySuggestion(`@${item.username}`);
                    }
                    return;
                  }
                  if (e.key === "Escape") {
                    setSuggestOpen(false);
                  }
                }}
                placeholder={resolvedPlaceholder}
                className="min-h-[44px] max-h-[160px] resize-none border-0 bg-transparent px-0 py-0 text-sm leading-snug text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-0 focus-visible:ring-offset-0"
                maxLength={2000}
                disabled={isSubmitting}
              />
              {suggestOpen && (
                <div
                  className="absolute left-4 right-4 top-full z-50 mt-1 max-h-[220px] overflow-y-auto rounded-lg border border-border bg-popover shadow-lg"
                  role="listbox"
                >
                  {suggestLoading ? (
                    <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Loading...</span>
                    </div>
                  ) : suggestType === "tag" ? (
                    tagSuggestions.length === 0 ? (
                      <p className="py-3 px-3 text-sm text-muted-foreground">No tags found</p>
                    ) : (
                      tagSuggestions.map((item, i) => (
                        <button
                          key={item.tag}
                          type="button"
                          role="option"
                          aria-selected={i === suggestIndex}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent ${i === suggestIndex ? "bg-accent" : ""}`}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            applySuggestion(`#${item.tag}`);
                          }}
                        >
                          <span className="font-medium text-primary">#{item.tag}</span>
                          {item.count != null && (
                            <span className="text-xs text-muted-foreground">{item.count} uses</span>
                          )}
                        </button>
                      ))
                    )
                  ) : mentionSuggestions.length === 0 ? (
                    <p className="py-3 px-3 text-sm text-muted-foreground">No users found</p>
                  ) : (
                    mentionSuggestions.map((item, i) => (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        aria-selected={i === suggestIndex}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent ${i === suggestIndex ? "bg-accent" : ""}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          applySuggestion(`@${item.username}`);
                        }}
                      >
                        <Avatar className="h-6 w-6">
                          <AvatarImage src={getProfilePicUrl(item.profile_pic)} alt={item.username} />
                          <AvatarFallback className="text-xs">{item.username.charAt(0).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <span className="font-medium text-foreground">@{item.username}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-border/50 px-2.5 pb-2.5 pt-2">
              <div className="flex min-w-0 flex-1 items-center gap-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      onClick={() => setGifOpen(true)}
                      aria-label="Add GIF"
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
                        <rect x="2" y="4" width="20" height="16" rx="3" stroke="currentColor" strokeWidth="1.65" />
                        <text x="12" y="15.5" textAnchor="middle" fill="currentColor" fontSize="8.5" fontWeight="700" fontFamily="system-ui, sans-serif">GIF</text>
                      </svg>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">GIF</TooltipContent>
                </Tooltip>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                  onChange={handleImageSelect}
                  className="hidden"
                />
                {isMobile ? (
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleImageSelect}
                    className="hidden"
                  />
                ) : null}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <button
                        type="button"
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                        onClick={() => imageInputRef.current?.click()}
                        disabled={isUploadingImage}
                        aria-label="Add photo from library"
                      >
                        <ImagePlus className="h-[22px] w-[22px]" strokeWidth={1.75} />
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">Photo library</TooltipContent>
                </Tooltip>
                {isMobile ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <button
                          type="button"
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                          onClick={() => cameraInputRef.current?.click()}
                          disabled={isUploadingImage}
                          aria-label="Open camera"
                        >
                          <Camera className="h-[22px] w-[22px]" strokeWidth={1.75} />
                        </button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">Camera</TooltipContent>
                  </Tooltip>
                ) : null}
                <span className="ml-1 hidden text-[11px] text-muted-foreground/60 tabular-nums sm:inline">
                  {content.length}/2000
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {onCancel && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-full px-3 text-xs text-muted-foreground"
                    onClick={onCancel}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="submit"
                      size="icon"
                      disabled={!canSubmit}
                      className="h-9 w-9 shrink-0 rounded-full"
                      aria-label={isSubmitting ? "Posting" : "Send"}
                    >
                      {isSubmitting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{isSubmitting ? "Posting…" : "Send"}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        </div>
      </form>

      <Dialog open={gifOpen} onOpenChange={setGifOpen}>
        <DialogContent
          showCloseButton={false}
          className="w-full h-[100dvh] max-w-full max-h-full rounded-none border-0 sm:rounded-lg sm:border sm:max-w-2xl sm:h-auto sm:max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2 sm:px-5 sm:pt-5">
            <DialogTitle className="text-lg font-semibold">Choose a GIF</DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full shrink-0"
              onClick={() => setGifOpen(false)}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Search */}
          <div className="px-4 pb-2 sm:px-5 space-y-1.5">
            <div className="flex gap-2 items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search GIFs..."
                  value={gifQuery}
                  onChange={(e) => setGifQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      searchGifs();
                    }
                  }}
                  className="pl-9 h-10 sm:h-9 rounded-full bg-muted/50 border-0 focus-visible:ring-1 focus-visible:ring-primary"
                />
              </div>
              <Button
                type="button"
                onClick={searchGifs}
                disabled={gifLoading}
                size="icon"
                className="h-10 w-10 sm:h-9 sm:w-9 rounded-full shrink-0"
              >
                {gifLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </Button>
            </div>
            {!gifQuery.trim() && (
              <p className="text-xs text-muted-foreground">
                Showing trending GIFs
              </p>
            )}
          </div>

          {gifError && (
            <div className="mx-4 sm:mx-5 rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2">
              {gifError}
            </div>
          )}

          {/* GIF grid  scrollable area fills remaining space */}
          <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 pb-2">
            {gifLoading && gifResults.length === 0 ? (
              <div className="flex items-center justify-center h-48">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : gifResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-sm gap-2">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="opacity-40">
                  <rect x="2" y="4" width="20" height="16" rx="3" stroke="currentColor" strokeWidth="1.5" />
                  <text x="12" y="15.5" textAnchor="middle" fill="currentColor" fontSize="8.5" fontWeight="700" fontFamily="system-ui, sans-serif">GIF</text>
                </svg>
                <span className="text-center px-4">
                  {gifQuery.trim()
                    ? "No GIFs found. Try another search."
                    : "No trending GIFs right now."}
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {gifResults.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="rounded-lg overflow-hidden border border-border bg-background hover:ring-2 hover:ring-primary hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary transition-all active:scale-95"
                    onClick={() => {
                      setGif(item);
                      setGifOpen(false);
                    }}
                  >
                    <img
                      src={item.previewUrl}
                      alt=""
                      loading="lazy"
                      className="w-full aspect-square object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Powered by GIPHY attribution */}
          <div className="flex items-center justify-center px-4 py-3 border-t border-border bg-background/80 backdrop-blur-sm shrink-0">
            <a
              href="https://giphy.com"
              target="_blank"
              rel="noopener noreferrer"
              className="opacity-80 hover:opacity-100 transition-opacity"
              aria-label="Powered by GIPHY"
            >
              <img
                src="/giphy-attribution-marks/Giphy%20Attribution%20Marks/Static%20Logos/Small/Light%20Backgrounds/PoweredBy_200px-White_HorizLogo.png"
                alt="Powered by GIPHY"
                className="h-6 w-auto object-contain"
              />
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default CommentForm;
