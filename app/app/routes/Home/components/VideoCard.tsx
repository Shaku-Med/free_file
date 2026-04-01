import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Button } from "~/components/ui/button";
import type { FileType } from "~/lib/types";
import ImageLoad from "./ImageLoad/ImageLoad";
import { getThumbnailUrl } from "~/lib/utils";
import ParseFilenameInsert from "~/lib/utils/ShowFileName";
import AdultContentBadge from "~/routes/Dynamic/components/AdultContentBadge";
import OwnerProfile from "~/components/OwnerProfile/OwnerProfile";
import Actions from "./VideoCard/Actions";
import { Separator } from "~/components/ui/separator";
import CategoryBadges from "~/components/CategoryBadges";
import { Info, MoreVertical, Clock, ListVideo, ChevronDown, X, Check, AlertTriangle, Send, Loader2, ImagePlus, MessageSquare, MessageSquareOff } from "lucide-react";
import { useFileContext } from "~/lib/Context/Context";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { useIsMobile } from "~/hooks/use-mobile";
import { useSidebar } from "~/components/ui/sidebar";
import { formatTimeAgo } from "~/lib/formatTimeAgo";

function getMetadataWarning(metadata: unknown): string | null {
  if (metadata && typeof metadata === "object" && "warning" in metadata) {
    const w = (metadata as Record<string, unknown>).warning;
    return typeof w === "string" && w.trim() ? w : null;
  }
  return null;
}

function formatViews(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(count);
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

type LayoutType = "default" | "horizontal" | "compact";

interface VideoCardProps {
  data: FileType;
  index?: number;
  currentUserId?: string;
  userActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
  onUpdate?: (fileId: string, updates: Partial<FileType>) => void;
  showOwnerControls?: boolean;
  related?: boolean;
  layout?: LayoutType;
}

const CATEGORIES = ["Gaming", "Music", "Entertainment", "Education", "Technology", "Sports", "News", "Lifestyle", "Anime", "Film", "Automotive", "Art", "Nature", "Other"];

const VideoCard = ({ data, index, currentUserId, userActions, onUpdate, showOwnerControls, related, layout = "default" }: VideoCardProps) => {
  const isMobile = useIsMobile();
  const {state} = useSidebar()
  // 
  const [error, setError] = useState<boolean>(false);
  const [retryAttempt, setRetryAttempt] = useState<number>(0);
  const [loaded, setLoaded] = useState<boolean>(false);
  const [liked, setLiked] = useState(userActions?.likedFileIds?.has(data.id) ?? false);
  const [disliked, setDisliked] = useState(userActions?.dislikedFileIds?.has(data.id) ?? false);
  const [likeCount, setLikeCount] = useState(Number(data.like_count ?? data.up_count) || 0);
  const [dislikeCount, setDislikeCount] = useState(Number(data.dislike_count ?? data.down_count) || 0);
  const uploadStatus = data.upload_status || "completed";
  const hasEndpoint = Boolean(data.endpoint);
  const isOwner = Boolean(currentUserId && data.owner_id && currentUserId === data.owner_id);
  const isPending = uploadStatus !== "completed" && !hasEndpoint;
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(data.file_title || "");
  const [editDescription, setEditDescription] = useState(data.file_description || "");
  const [editIsPublic, setEditIsPublic] = useState(Boolean(data.is_public));
  const [editCategories, setEditCategories] = useState<string[]>(() => {
    if (Array.isArray(data.categories)) return data.categories.filter((c): c is string => typeof c === "string");
    return [];
  });
  const [editTags, setEditTags] = useState<string[]>(() => {
    if (Array.isArray(data.tags)) return data.tags.filter((t): t is string => typeof t === "string");
    return [];
  });
  const [tagInput, setTagInput] = useState("");
  const [catDropdownOpen, setCatDropdownOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [infoModalOpen, setInfoModalOpen] = useState(false);
  // Thumbnail edit state
  const [selectedThumbPath, setSelectedThumbPath] = useState<string | null>(null);
  const [customThumbFile, setCustomThumbFile] = useState<File | null>(null);
  const [customThumbPreview, setCustomThumbPreview] = useState<string | null>(null);
  const [isUploadingThumb, setIsUploadingThumb] = useState(false);
  const thumbInputRef = useRef<HTMLInputElement>(null);
  // Thumbnail browser dialog state
  const [thumbBrowseOpen, setThumbBrowseOpen] = useState(false);
  const [browseThumbs, setBrowseThumbs] = useState<string[]>([]);
  const [browseHasMore, setBrowseHasMore] = useState(false);
  const [browseOffset, setBrowseOffset] = useState(0);
  const [browseLoading, setBrowseLoading] = useState(false);
  const THUMB_PAGE_SIZE = 20;

  // Adult review request state
  const [reviewStatus, setReviewStatus] = useState<{
    has_request: boolean;
    request_count: number;
    status?: string;
    response_message?: string;
    accepted?: boolean;
    can_request: boolean;
  } | null>(null);
  const [reviewReason, setReviewReason] = useState("");
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [reviewMessage, setReviewMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [editCommentsEnabled, setEditCommentsEnabled] = useState(data.comments_enabled !== false);
  const [editCommentMax, setEditCommentMax] = useState(() => {
    const lim = data.comment_limit;
    return typeof lim === "number" && lim > 0 ? String(lim) : "";
  });
  /** Latest `default_thumbnail` from GET /api/files prefill; `undefined` = use `data` until loaded. */
  const [editLoadedDefaultThumb, setEditLoadedDefaultThumb] = useState<string | null | undefined>(undefined);

  const catDropdownRef = useRef<HTMLDivElement>(null);
  const { uploadServerUrl, c_user } = useFileContext();

  const nav = useNavigate();
  const metadataWarning = getMetadataWarning(data.metadata);
  const commentCount = Number(data.comment_count) || 0;
  const viewCount = Number(data.view_count ?? data.views) || 0;

  useEffect(() => {
    if (userActions && data.id) {
      setLiked(userActions.likedFileIds.has(data.id));
      setDisliked(userActions.dislikedFileIds.has(data.id));
    }
  }, [userActions, data.id]);

  useEffect(() => {
    if (isEditing) return;
    setEditTitle(data.file_title || "");
    setEditDescription(data.file_description || "");
    setEditIsPublic(Boolean(data.is_public));
    setEditCategories(Array.isArray(data.categories) ? data.categories.filter((c): c is string => typeof c === "string") : []);
    setEditTags(Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === "string") : []);
    setEditCommentsEnabled(data.comments_enabled !== false);
    const lim = data.comment_limit;
    setEditCommentMax(typeof lim === "number" && lim > 0 ? String(lim) : "");
  }, [
    isEditing,
    data.file_title,
    data.file_description,
    data.is_public,
    data.categories,
    data.tags,
    data.comments_enabled,
    data.comment_limit,
  ]);

  useEffect(() => {
    if (!isEditing) setEditLoadedDefaultThumb(undefined);
  }, [isEditing]);

  useEffect(() => {
    if (!isEditing || !isOwner) return;
    const fid = data.id || data.unique_id;
    if (!fid) return;
    let cancelled = false;
    setEditError(null);
    (async () => {
      try {
        const res = await fetch(`/api/files?fileId=${encodeURIComponent(String(fid))}`, {
          credentials: "include",
        });
        const json = (await res.json().catch(() => null)) as {
          success?: boolean;
          file?: Record<string, unknown>;
          error?: string;
        } | null;
        if (cancelled) return;
        if (!res.ok || !json?.success || !json.file) {
          if (json?.error) setEditError(json.error);
          return;
        }
        const f = json.file;
        setEditTitle(typeof f.file_title === "string" ? f.file_title : "");
        setEditDescription(typeof f.file_description === "string" ? f.file_description : "");
        setEditIsPublic(f.is_public !== false);
        const cats = f.categories;
        setEditCategories(
          Array.isArray(cats) ? cats.filter((c): c is string => typeof c === "string") : []
        );
        const tagList = f.tags;
        setEditTags(Array.isArray(tagList) ? tagList.filter((t): t is string => typeof t === "string") : []);
        setEditCommentsEnabled(f.comments_enabled !== false);
        const lim = f.comment_limit;
        setEditCommentMax(typeof lim === "number" && lim > 0 ? String(lim) : "");
        if (Object.prototype.hasOwnProperty.call(f, "default_thumbnail")) {
          const dt = f.default_thumbnail;
          setEditLoadedDefaultThumb(typeof dt === "string" ? dt : dt == null ? null : undefined);
        }
      } catch {
        if (!cancelled) setEditError("Could not load the latest file settings.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEditing, isOwner, data.id, data.unique_id]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (catDropdownRef.current && !catDropdownRef.current.contains(event.target as Node)) {
        setCatDropdownOpen(false);
      }
    };

    if (catDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [catDropdownOpen]);

  const handleInteractionUpdate = (updates: { liked: boolean; disliked: boolean; like_count: number; dislike_count: number }) => {
    setLiked(updates.liked);
    setDisliked(updates.disliked);
    setLikeCount(updates.like_count);
    setDislikeCount(updates.dislike_count);
  };

  const handleSave = async () => {
    if (!data.id) {
      setEditError("Missing file id.");
      return;
    }
    setIsSaving(true);
    setEditError(null);
    try {
      let newDefaultThumbnail: string | undefined;

      // Images use their own endpoint as thumbnail — no thumbnail editing allowed
      if (!data.file_type?.startsWith("image/") && customThumbFile) {
        setIsUploadingThumb(true);
        try {
          const formData = new FormData();
          formData.append("file", customThumbFile);
          formData.append("unique_id", data.unique_id);
          // Build date_folder from created_at
          const d = new Date(data.created_at);
          const dd = String(d.getUTCDate()).padStart(2, "0");
          const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
          const yyyy = d.getUTCFullYear();
          formData.append("date_folder", `${dd}_${mm}_${yyyy}`);
          formData.append("is_adult", String(!!data.is_adult));

          const base = uploadServerUrl?.replace(/\/$/, "") || "";
          const headers: Record<string, string> = {};
          if (c_user) headers["Authorization"] = `Bearer ${c_user}`;

          const thumbRes = await fetch(`${base}/api/thumbnail/upload`, {
            method: "POST",
            headers,
            body: formData,
          });
          const thumbJson = await thumbRes.json();
          if (!thumbRes.ok) {
            setEditError(thumbJson.error || "Thumbnail upload failed.");
            setIsUploadingThumb(false);
            setIsSaving(false);
            return;
          }
          newDefaultThumbnail = thumbJson.default_thumbnail;
        } catch {
          setEditError("Thumbnail upload failed.");
          setIsUploadingThumb(false);
          setIsSaving(false);
          return;
        }
        setIsUploadingThumb(false);
      } else if (selectedThumbPath) {
        // User selected an existing frame thumbnail as default
        newDefaultThumbnail = selectedThumbPath;
      }

      let commentLimit: number | null | undefined = undefined;
      if (editCommentsEnabled) {
        const t = editCommentMax.trim();
        if (t === "") {
          commentLimit = null;
        } else {
          const n = parseInt(t, 10);
          if (!Number.isFinite(n) || n < 1 || n > 1_000_000) {
            setEditError("Max comments must be empty (unlimited) or a number from 1 to 1000000.");
            setIsSaving(false);
            return;
          }
          commentLimit = n;
        }
      }

      const response = await fetch("/api/files", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: data.id || data.unique_id,
          title: editTitle,
          description: editDescription,
          isPublic: editIsPublic,
          categories: editCategories,
          tags: editTags,
          commentsEnabled: editCommentsEnabled,
          ...(editCommentsEnabled ? { commentLimit } : {}),
          ...(newDefaultThumbnail !== undefined ? { defaultThumbnail: newDefaultThumbnail } : {}),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setEditError(payload?.error || "Failed to update file.");
        return;
      }

      const payload = await response.json().catch(() => null);
      if (payload?.file && onUpdate) {
        const thumbFromServer = payload.file.default_thumbnail;
        const nextDefaultThumb =
          thumbFromServer !== undefined && thumbFromServer !== null
            ? String(thumbFromServer)
            : newDefaultThumbnail !== undefined
              ? newDefaultThumbnail
              : undefined;
        onUpdate(data.id, {
          file_title: payload.file.file_title ?? editTitle,
          file_description: payload.file.file_description ?? editDescription,
          is_public: payload.file.is_public ?? editIsPublic,
          categories: payload.file.categories ?? editCategories,
          tags: payload.file.tags ?? editTags,
          comments_enabled: payload.file.comments_enabled,
          comment_limit: payload.file.comment_limit,
          ...(nextDefaultThumb !== undefined ? { default_thumbnail: nextDefaultThumb } : {}),
        });
        if (nextDefaultThumb !== undefined) {
          setEditLoadedDefaultThumb(nextDefaultThumb || null);
        }
      }
      // Reset thumbnail state
      setSelectedThumbPath(null);
      setCustomThumbFile(null);
      if (customThumbPreview) URL.revokeObjectURL(customThumbPreview);
      setCustomThumbPreview(null);
      setIsEditing(false);
    } catch {
      setEditError("Failed to update file.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCategoryToggle = (cat: string) => {
    if (isSaving) return;
    setEditCategories((prev) => 
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleRemoveCategory = (cat: string) => {
    if (isSaving) return;
    setEditCategories((prev) => prev.filter((c) => c !== cat));
  };

  const handleRemoveTag = (index: number) => {
    if (isSaving) return;
    setEditTags((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
      e.preventDefault();
      const val = tagInput.trim().slice(0, 50);
      if (val && editTags.length < 15 && !editTags.includes(val)) {
        setEditTags((prev) => [...prev, val]);
      }
      setTagInput("");
    }
    if (e.key === "Backspace" && !tagInput && editTags.length > 0) {
      setEditTags((prev) => prev.slice(0, -1));
    }
  };

  // Fetch adult review status when edit dialog opens for adult content
  useEffect(() => {
    if (isEditing && data.is_adult && isOwner && data.id) {
      fetch("/api/adult-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_id: data.id, action: "status" }),
      })
        .then((r) => r.json())
        .then((res) => {
          if (res.success) {
            setReviewStatus(res);
          }
        })
        .catch(() => {});
    }
  }, [isEditing, data.is_adult, isOwner, data.id]);

  const handleSubmitReview = async () => {
    if (!data.id || isSubmittingReview) return;
    setIsSubmittingReview(true);
    setReviewMessage(null);
    try {
      const res = await fetch("/api/adult-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_id: data.id,
          action: "submit",
          reason: reviewReason.trim() || null,
        }),
      });
      const result = await res.json();
      if (result.success) {
        setReviewMessage({ type: "success", text: "Review request submitted. You will be notified of the decision." });
        setReviewStatus((prev) => prev ? {
          ...prev,
          has_request: true,
          request_count: result.request_count,
          status: "pending",
          can_request: false,
        } : prev);
        setShowReviewForm(false);
        setReviewReason("");
      } else {
        setReviewMessage({ type: "error", text: result.error || "Failed to submit request." });
      }
    } catch {
      setReviewMessage({ type: "error", text: "Failed to submit request." });
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const thumbnailLink = useMemo(() => getThumbnailUrl(data, { retryAttempt }), [data.file_type, data.endpoint, data.default_thumbnail, data.thumbnails, data.created_at, data.unique_id, data.filename, retryAttempt]);

  /** Saved thumbnail path for edit dialog (video/audio only); quality set on ImageLoad. */
  const editDialogCurrentThumbLink = useMemo(() => {
    if (data.file_type?.startsWith("image/")) return "";
    const merged = {
      ...data,
      default_thumbnail:
        editLoadedDefaultThumb !== undefined ? editLoadedDefaultThumb : data.default_thumbnail,
    };
    return getThumbnailUrl(merged, {});
  }, [
    data.file_type,
    data.endpoint,
    data.default_thumbnail,
    data.created_at,
    data.unique_id,
    data.filename,
    editLoadedDefaultThumb,
  ]);

  const handleRetry = useCallback(() => {
    if (retryAttempt >= 1) {
      setError(true);
      return;
    }
    setRetryAttempt((prev) => prev + 1);
  }, [retryAttempt]);

  const handleImageLoaded = useCallback((e: { src: string; colors: string[] }) => {
    if (e) setLoaded(true);
  }, []);

  const renderThumbnail = (className?: string) => (
    <div className={`relative ${className || ""}`}>
      {data.is_adult && <AdultContentBadge />}
      <motion.div
        transition={{ duration: 0.1, ease: "easeOut", damping: 10, stiffness: 100 }}
        className="w-full h-full"
      >
        {!error && !isPending ? (
          <ImageLoad
            link={thumbnailLink}
            imageID={data.unique_id}
            index={index}
            retry={handleRetry}
            className="w-full h-full object-cover transition-all duration-300"
            callBack={handleImageLoaded}
            quality={50}
            hasAdultTag={Boolean(data.is_adult)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted text-xs text-center">
            <span>{isPending ? "Processing upload..." : "Failed to load image"}</span>
          </div>
        )}
        {layout === "default" && <CategoryBadges categories={data.categories} />}
        {data.duration && data.duration > 0 && (
          <div className="file_duration flex items-center absolute right-2 shadow-md border backdrop-blur-lg bottom-1 bg-card/50 rounded-lg px-2 py-1 text-xs font-medium">
            <span>{formatDuration(data.duration)}</span>
          </div>
        )}
      </motion.div>
    </div>
  );

  const renderEditDialog = () => (
    <Dialog open={isEditing} onOpenChange={(open) => {
      if (!isSaving) {
        setIsEditing(open);
        if (!open) {
          setCatDropdownOpen(false);
        }
      }
    }}>
      <DialogContent className="w-full rounded-2xl max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>Edit upload</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 overflow-y-auto flex-1 pr-1">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Title</label>
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              maxLength={200}
              disabled={isSaving}
              className="bg-muted/50 text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <Textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={3}
              maxLength={5000}
              disabled={isSaving}
              className="bg-muted/50 text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Visibility</label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={editIsPublic ? "default" : "outline"}
                className="rounded-full px-4"
                onClick={() => setEditIsPublic(true)}
                disabled={isSaving}
              >
                Public
              </Button>
              <Button
                type="button"
                variant={!editIsPublic ? "default" : "outline"}
                className="rounded-full px-4"
                onClick={() => setEditIsPublic(false)}
                disabled={isSaving}
              >
                Private
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Comments</label>
            <div className="flex rounded-lg border border-border/50 overflow-hidden bg-muted/30">
              <button
                type="button"
                onClick={() => setEditCommentsEnabled(true)}
                disabled={isSaving}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium transition-all disabled:cursor-not-allowed ${
                  editCommentsEnabled
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                On
              </button>
              <button
                type="button"
                onClick={() => setEditCommentsEnabled(false)}
                disabled={isSaving}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium transition-all disabled:cursor-not-allowed ${
                  !editCommentsEnabled
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <MessageSquareOff className="w-3.5 h-3.5" />
                Off
              </button>
            </div>
            {editCommentsEnabled && (
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Max comments (optional)</label>
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="Unlimited"
                  value={editCommentMax}
                  onChange={(e) => setEditCommentMax(e.target.value.replace(/\D/g, "").slice(0, 7))}
                  disabled={isSaving}
                  className="bg-muted/50 text-foreground placeholder:text-muted-foreground h-9 text-sm"
                />
                <p className="text-[10px] text-muted-foreground/70">Leave empty for no limit. Reached limit blocks new comments.</p>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Categories</label>
            {editCategories.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {editCategories.map((cat) => (
                  <span
                    key={cat}
                    className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs font-medium px-2 py-1 rounded-full"
                  >
                    {cat}
                    <button
                      type="button"
                      onClick={() => handleRemoveCategory(cat)}
                      className="hover:text-destructive transition-colors"
                      disabled={isSaving}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative" ref={catDropdownRef}>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => setCatDropdownOpen((prev) => !prev)}
                className="w-full flex items-center justify-between rounded-md border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
              >
                <span>Select categories...</span>
                <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${catDropdownOpen ? "rotate-180" : ""}`} />
              </button>
              {catDropdownOpen && (
                <div className="absolute z-[100] mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
                  {CATEGORIES.map((cat) => {
                    const selected = editCategories.includes(cat);
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => handleCategoryToggle(cat)}
                        disabled={isSaving}
                        className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-accent flex items-center gap-2 ${selected ? "bg-primary/10 text-primary font-medium" : "text-foreground"}`}
                      >
                        <span className={`w-4 h-4 rounded border flex items-center justify-center text-xs shrink-0 ${selected ? "bg-primary border-primary text-primary-foreground" : "border-input"}`}>
                          {selected && <Check className="w-3 h-3" />}
                        </span>
                        {cat}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">Tags</label>
              <span className="text-xs text-muted-foreground tabular-nums">{editTags.length}/15</span>
            </div>
            {editTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {editTags.map((tag, i) => (
                  <span
                    key={`${tag}-${i}`}
                    className="inline-flex items-center gap-1 bg-muted text-foreground text-xs px-2 py-1 rounded-full"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(i)}
                      className="hover:text-destructive transition-colors"
                      disabled={isSaving}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              placeholder="Type a tag and press Enter..."
              maxLength={50}
              disabled={isSaving || editTags.length >= 15}
              className="bg-muted/50 text-foreground placeholder:text-muted-foreground"
            />
          </div>
          {/* Thumbnail selector — only for video/audio, not images */}
          {!data.file_type?.startsWith("image/") && <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Thumbnail</label>
            {editDialogCurrentThumbLink ? (
              <div className="rounded-lg border border-border/50 bg-muted/20 overflow-hidden">
                <p className="text-[11px] font-medium text-muted-foreground px-2.5 py-1.5 border-b border-border/40 bg-muted/30">
                  Current thumbnail
                </p>
                <div className="p-2 flex justify-center items-center bg-background/40 min-h-[5rem]">
                  <ImageLoad
                    link={editDialogCurrentThumbLink}
                    imageID={`${data.unique_id}_edit_dialog_thumb`}
                    index={0}
                    retry={() => {}}
                    quality={60}
                    hasAdultTag={Boolean(data.is_adult)}
                    className="max-h-32 w-full max-w-[280px] object-contain rounded-md"
                    eagerLoad
                    useRelativeApiUrl
                  />
                </div>
                <p className="text-[10px] text-muted-foreground/70 px-2.5 pb-2">
                  Saved thumbnail on the server. Pick a frame or upload below to replace it.
                </p>
              </div>
            ) : null}
            <input
              ref={thumbInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (thumbInputRef.current) thumbInputRef.current.value = "";
                if (!file) return;
                if (!file.type.startsWith("image/")) return;
                if (file.size > 10 * 1024 * 1024) return;
                if (customThumbPreview) URL.revokeObjectURL(customThumbPreview);
                setCustomThumbFile(file);
                setCustomThumbPreview(URL.createObjectURL(file));
                setSelectedThumbPath(null);
              }}
              className="hidden"
            />
            {/* Custom upload preview */}
            {customThumbPreview && (
              <div className="relative inline-flex rounded-lg overflow-hidden border-2 border-primary">
                <img src={customThumbPreview} alt="Custom thumbnail" className="h-16 w-auto object-contain rounded-lg" />
                <button
                  type="button"
                  onClick={() => {
                    if (customThumbPreview) URL.revokeObjectURL(customThumbPreview);
                    setCustomThumbFile(null);
                    setCustomThumbPreview(null);
                  }}
                  className="absolute right-0.5 top-0.5 h-4 w-4 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            )}
            {/* Selected frame thumbnail preview */}
            {selectedThumbPath && !customThumbPreview && (
              <div className="relative inline-flex rounded-lg overflow-hidden border-2 border-primary">
                <img src={`/api/load/image/${selectedThumbPath}?quality=30`} alt="Selected thumbnail" className="h-16 w-auto object-contain rounded-lg" />
                <button
                  type="button"
                  onClick={() => setSelectedThumbPath(null)}
                  className="absolute right-0.5 top-0.5 h-4 w-4 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            )}
            {/* Browse frame thumbnails button */}
            {!customThumbPreview && (
              <button
                type="button"
                onClick={async () => {
                  setThumbBrowseOpen(true);
                  if (browseThumbs.length === 0) {
                    setBrowseLoading(true);
                    try {
                      const res = await fetch(`/api/files/thumbnails?fileId=${data.id}&limit=${THUMB_PAGE_SIZE}&offset=0`);
                      if (res.ok) {
                        const json = await res.json();
                        setBrowseThumbs(json.thumbnails || []);
                        setBrowseHasMore(json.hasMore || false);
                        setBrowseOffset(json.thumbnails?.length || 0);
                      }
                    } catch {}
                    setBrowseLoading(false);
                  }
                }}
                disabled={isSaving}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/5 transition-all disabled:opacity-50"
              >
                <ImagePlus className="w-3.5 h-3.5" />
                Browse frame thumbnails
              </button>
            )}
            {/* Thumbnail browser dialog */}
            <Dialog open={thumbBrowseOpen} onOpenChange={setThumbBrowseOpen}>
              <DialogContent className="w-[calc(100%-2rem)] max-w-5xl md:max-h-[80vh] h-fit overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="text-sm">Choose a thumbnail</DialogTitle>
                </DialogHeader>
                {browseLoading && browseThumbs.length === 0 ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : browseThumbs.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">No frame thumbnails available.</p>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      {browseThumbs.map((thumb, thumbIdx) => {
                        const isSelected = selectedThumbPath === thumb;
                        const isCurrent = data.default_thumbnail === thumb;
                        return (
                          <button
                            key={thumb}
                            type="button"
                            onClick={() => {
                              setSelectedThumbPath(isSelected ? null : thumb);
                              setCustomThumbFile(null);
                              if (customThumbPreview) URL.revokeObjectURL(customThumbPreview);
                              setCustomThumbPreview(null);
                              setThumbBrowseOpen(false);
                            }}
                            className={`relative bg-muted/40 aspect-video rounded-md overflow-hidden border-2 transition-all ${
                              isSelected
                                ? "border-primary ring-1 ring-primary/30"
                                : isCurrent
                                ? "border-primary/40"
                                : "border-transparent hover:border-muted-foreground/40"
                            }`}
                          >
                            <ImageLoad
                              link={`/api/load/image/${thumb}`}
                              imageID={`${data.unique_id}_browse_${thumbIdx}`}
                              index={0}
                              retry={() => {}}
                              quality={30}
                              hasAdultTag={Boolean(data.is_adult)}
                              className="w-full h-full object-contain"
                              eagerLoad
                              useRelativeApiUrl
                            />
                            {(isSelected || isCurrent) && (
                              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                <Check className="h-3 w-3 text-white drop-shadow" />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {browseHasMore && (
                      <button
                        type="button"
                        onClick={async () => {
                          setBrowseLoading(true);
                          try {
                            const res = await fetch(`/api/files/thumbnails?fileId=${data.id}&limit=${THUMB_PAGE_SIZE}&offset=${browseOffset}`);
                            if (res.ok) {
                              const json = await res.json();
                              setBrowseThumbs((prev) => [...prev, ...(json.thumbnails || [])]);
                              setBrowseHasMore(json.hasMore || false);
                              setBrowseOffset((prev) => prev + (json.thumbnails?.length || 0));
                            }
                          } catch {}
                          setBrowseLoading(false);
                        }}
                        disabled={browseLoading}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 mt-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all disabled:opacity-50"
                      >
                        {browseLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Load more"}
                      </button>
                    )}
                  </>
                )}
              </DialogContent>
            </Dialog>
            {/* Upload custom button */}
            {!customThumbPreview && (
              <button
                type="button"
                onClick={() => thumbInputRef.current?.click()}
                disabled={isSaving}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/5 transition-all disabled:opacity-50"
              >
                <ImagePlus className="w-3.5 h-3.5" />
                Upload custom thumbnail
              </button>
            )}
            {isUploadingThumb && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Uploading thumbnail...
              </div>
            )}
          </div>}

          {data.is_adult && (
            <div className="space-y-2">
              <div className="rounded-lg borde bg-destructive/10 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-destructive text-white text-[10px] font-bold shrink-0">18</span>
                  <p className="text-sm font-medium text-destructive">Adult content</p>
                </div>
                <div className="mt-1.5 flex items-start gap-1.5 pl-6">
                  <p className="text-[11px] text-destructive/80 leading-relaxed">
                    This post is flagged as adult content. Even if set to public, it can <strong>only be accessed via direct link</strong> and will <strong>not appear in feeds</strong>, search results, or suggestions.
                  </p>
                </div>
              </div>

              {/* Review request section */}
              {isOwner && reviewStatus && (
                <div className="rounded-lg border bg-muted/40 px-3 py-2.5">
                  {reviewStatus.status === "pending" && (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
                      <p className="text-[11px] text-foreground">
                        Review request pending ({reviewStatus.request_count}/2 requests used)
                      </p>
                    </div>
                  )}

                  {reviewStatus.status === "accepted" && (
                    <div className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                      <p className="text-[11px] text-primary">
                        Review accepted — adult flag has been removed.
                      </p>
                    </div>
                  )}

                  {reviewStatus.status === "denied" && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <X className="w-3.5 h-3.5 text-primary shrink-0" />
                        <p className="text-[11px] text-primary">
                          Review denied{reviewStatus.response_message ? `: ${reviewStatus.response_message}` : ""} ({reviewStatus.request_count}/2 requests used)
                        </p>
                      </div>
                    </div>
                  )}

                  {!reviewStatus.has_request && reviewStatus.can_request && (
                    <p className="text-[11px] text-foreground">
                      Think this was incorrectly flagged? <br /> You can request a manual review (max 2 per file).
                    </p>
                  )}

                  {/* Show request button */}
                  {reviewStatus.can_request && !showReviewForm && (
                    <button
                      type="button"
                      onClick={() => setShowReviewForm(true)}
                      className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-primary hover:text-primary/80 transition-colors"
                    >
                      <Send className="w-3 h-3" />
                      Request review
                    </button>
                  )}

                  {/* Review form */}
                  {showReviewForm && reviewStatus.can_request && (
                    <div className="mt-2 space-y-2">
                      <Textarea
                        value={reviewReason}
                        onChange={(e) => setReviewReason(e.target.value)}
                        placeholder="Why do you think this was incorrectly flagged? (optional)"
                        rows={2}
                        maxLength={500}
                        className="text-xs bg-muted/50 text-foreground placeholder:text-muted-foreground"
                        disabled={isSubmittingReview}
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleSubmitReview}
                          disabled={isSubmittingReview}
                          className="h-7 text-xs px-3"
                        >
                          {isSubmittingReview ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin mr-1" />
                              Sending...
                            </>
                          ) : (
                            "Submit request"
                          )}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => { setShowReviewForm(false); setReviewReason(""); }}
                          disabled={isSubmittingReview}
                          className="h-7 text-xs px-3"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Review message feedback */}
                  {reviewMessage && (
                    <p className={`mt-1.5 text-[11px] ${reviewMessage.type === "success" ? "text-primary" : "text-primary"}`}>
                      {reviewMessage.text}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          {editError && <p className="text-xs text-destructive">{editError}</p>}
        </div>
        <DialogFooter className="gap-2 shrink-0 border-t pt-4">
          <Button 
            type="button" 
            variant="ghost" 
            onClick={() => {
              setIsEditing(false);
              setCatDropdownOpen(false);
            }} 
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const renderInfoDialog = () => (
    metadataWarning && (
      <Dialog open={infoModalOpen} onOpenChange={setInfoModalOpen}>
        <DialogContent className="rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="size-5 text-muted-foreground" />
              Content information
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{metadataWarning}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setInfoModalOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  );

  if (layout === "horizontal") {
    return (
      <div className={`flex ${(state === 'expanded') ? `fl_break_layout text-sm` : `flex-col md:flex-row flex-wrap` } gap-3 p-2 rounded-xl hover:bg-muted/50 transition-colors w-full`}>
        <Link
          onClick={(e) => {
            e.preventDefault();
            nav(`/${data.unique_id}`);
          }}
          to={`/${data.unique_id}`}
          className="shrink-0 w-full min-w-40 max-w-40 md:max-w-44 aspect-video bg-card rounded-xl overflow-hidden relative flex-1"
        >
          {renderThumbnail("w-full h-full aspect-video")}
          <div className="absolute top-2 right-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
              type="button"
              className="p-1.5 bg-black/70 rounded-full hover:bg-black/90 transition-colors"
              onClick={(e) => e.preventDefault()}
            >
              <Clock className="size-4 text-white" />
            </button>
            <button 
              type="button"
              className="p-1.5 bg-black/70 rounded-full hover:bg-black/90 transition-colors"
              onClick={(e) => e.preventDefault()}
            >
              <ListVideo className="size-4 text-white" />
            </button>
          </div>
        </Link>

        <div className="flex-1 min-w-0 flex flex-col justify-center py-0.5 w-full">
          <div className="flex items-start justify-between gap-2">
            <Link to={`/${data.unique_id}`} className="hover:text-primary transition-colors flex-1 min-w-0">
              <h3 className="text-sm font-semibold leading-tight line-clamp-2">
                <ParseFilenameInsert filename={data.file_title || data.filename} showLimit={60} />
              </h3>
            </Link>
          </div>
          
          {data.owner && (
            <Link to={`/profile/${data.owner.username}`} className="text-xs text-muted-foreground hover:text-foreground transition-colors mt-1 block w-fit">
              {data.owner.username}
            </Link>
          )}
          
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
            {viewCount > 0 && <span>{formatViews(viewCount)} views</span>}
            {viewCount > 0 && data.created_at && <span>·</span>}
            {data.created_at && <span>{formatTimeAgo(data.created_at)}</span>}
          </div>

          <div className="w-full">
            <Separator className="my-1" />
            <Actions
              fileId={data.id ?? ""}
              uniqueId={data.unique_id}
              likeCount={likeCount}
              dislikeCount={dislikeCount}
              commentCount={commentCount}
              liked={liked}
              disliked={disliked}
              isOwner={isOwner}
              onEdit={isOwner ? () => setIsEditing(true) : undefined}
              onUpdate={currentUserId ? handleInteractionUpdate : undefined}
              currentUserId={currentUserId}
              fileCreatedAt={data.created_at}
            />
          </div>
        </div>

        {renderEditDialog()}
        {renderInfoDialog()}
      </div>
    );
  }

  if (layout === "compact") {
    return (
      <div className="group flex gap-2 p-1.5 rounded-lg hover:bg-muted/50 transition-colors">
        <Link
          onClick={(e) => {
            e.preventDefault();
            nav(`/${data.unique_id}`);
          }}
          to={`/${data.unique_id}`}
          className="shrink-0 w-24 max-h-24 aspect-video bg-card rounded-lg overflow-hidden relative"
        >
          {renderThumbnail("w-full h-full")}
        </Link>

        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <Link to={`/${data.unique_id}`} className="hover:text-primary transition-colors">
            <h3 className="text-xs font-medium leading-tight line-clamp-2">
              <ParseFilenameInsert filename={data.file_title || data.filename} showLimit={40} />
            </h3>
          </Link>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
            {data.owner && (
              <span className="truncate max-w-[80px]">{data.owner.username}</span>
            )}
            {data.owner && viewCount > 0 && <span>·</span>}
            {viewCount > 0 && <span>{formatViews(viewCount)}</span>}
          </div>

          <div className="ac_dev w-full">
          <Separator className="my-2" />
          <Actions
            fileId={data.id ?? ""}
            uniqueId={data.unique_id}
            likeCount={likeCount}
            dislikeCount={dislikeCount}
            commentCount={commentCount}
            liked={liked}
            disliked={disliked}
            isOwner={isOwner}
            onEdit={isOwner ? () => setIsEditing(true) : undefined}
            onUpdate={currentUserId ? handleInteractionUpdate : undefined}
            currentUserId={currentUserId}
            fileCreatedAt={data.created_at}
          />
        </div>
        </div>

        {renderEditDialog()}
        {renderInfoDialog()}
      </div>
    );
  }

  return (
    <div className="item group rounded-2xl relative flex flex-col py-4 h-full">
      <Link
        onClick={(e) => {
          e.preventDefault();
          nav(`/${data.unique_id}`);
        }}
        to={`/${data.unique_id}`}
        className="w-full bg-card rounded-2xl overflow-hidden relative aspect-video group-hover:z-[1000000] z-[10]"
      >
        {renderThumbnail("w-full h-full")}
      </Link>

      <div
        className="hover_overlay pointer-events-none absolute inset-0 z-[10] rounded-2xl bg-muted/50 opacity-0 scale-100 group-hover:z-[100] group-hover:opacity-100 group-hover:scale-105 transition-all duration-300 ease-out"
      />

      <div className="py-2 flex flex-col z-[1000000]">
        <div className="pointer-events-auto mb-1 flex items-start gap-3">
          {data.owner && (
            <OwnerProfile 
              showUsername={false} 
              owner={data.owner} 
              size="sm" 
              className="text-white/90 hover:text-white shrink-0 mt-0.5" 
            />
          )}
          <div className="flex-1 min-w-0 h-[2.5rem]">
            <div className="flex items-start gap-1.5">
              <Link to={`/${data.unique_id}`} className="hover:text-primary transition-colors flex-1 min-w-0">
                <h3 className="text-sm md:text-base font-semibold leading-tight line-clamp-2 ">
                  <ParseFilenameInsert filename={data.file_title || data.filename} showLimit={50} />
                </h3>
              </Link>
              {metadataWarning && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setInfoModalOpen(true);
                      }}
                      className="shrink-0 rounded-full p-1 text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                      aria-label="Content information"
                    >
                      <Info className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[200px]">
                    <p>Content information</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground h-[1.25rem]">
              {data.owner && (
                <Link to={`/profile/${data.owner.username}`} className="hover:text-foreground transition-colors truncate max-w-[120px]">
                  {data.owner.username}
                </Link>
              )}
              {data.owner && viewCount > 0 && <span>·</span>}
              {viewCount > 0 && <span>{formatViews(viewCount)} views</span>}
            </div>
          </div>
        </div>

        <div className="ac_dev w-full">
          <Separator className="my-2" />
          <Actions
            fileId={data.id ?? ""}
            uniqueId={data.unique_id}
            likeCount={likeCount}
            dislikeCount={dislikeCount}
            commentCount={commentCount}
            liked={liked}
            disliked={disliked}
            isOwner={isOwner}
            onEdit={isOwner ? () => setIsEditing(true) : undefined}
            onUpdate={currentUserId ? handleInteractionUpdate : undefined}
            currentUserId={currentUserId}
            fileCreatedAt={data.created_at}
          />
        </div>
      </div>

      {renderEditDialog()}
      {renderInfoDialog()}
    </div>
  );
};

export default VideoCard;