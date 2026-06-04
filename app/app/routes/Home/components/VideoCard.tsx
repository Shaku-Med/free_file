import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Button } from "~/components/ui/button";
import { type FileType, fileWatchPath } from "~/lib/types";
import ImageLoad from "./ImageLoad/ImageLoad";
import { cn, getDefaultThumbnail, getThumbnailUrl } from "~/lib/utils";
import ParseFilenameInsert from "~/lib/utils/ShowFileName";
import AdultContentBadge from "~/routes/Dynamic/components/AdultContentBadge";
import OwnerProfile from "~/components/OwnerProfile/OwnerProfile";
import Actions from "./VideoCard/Actions";
import { Separator } from "~/components/ui/separator";
import { Progress } from "~/components/ui/progress";
import CategoryBadges from "~/components/CategoryBadges";
import { Info, MoreVertical, ChevronDown, X, Check, AlertTriangle, Send, Loader2, ImagePlus, MessageSquare, MessageSquareOff, ListVideo, Layers, ListPlus, ListChecks, Captions, Clapperboard } from "lucide-react";
import { CaptionModal, type CaptionEntry } from "~/components/captions/CaptionModal";
import { findLanguageLabel } from "~/lib/captions/vtt";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { useIsMobile } from "~/hooks/use-mobile";
import { useSidebarOptional } from "~/components/ui/sidebar";
import { formatTimeAgo } from "~/lib/formatTimeAgo";
import { EpisodePicker } from "./EpisodePicker";
import WatchProgressBar from "./WatchProgressBar";
import { SeriesEpisodesPreviewDialog } from "~/components/SeriesEpisodesPreviewDialog";

function tryUnwrapJsonEntry(val: string): CaptionEntry | null {
  const s = val.trim();
  if (!s.startsWith("{")) return null;
  try {
    const p = JSON.parse(s);
    if (p && typeof p === "object" && typeof p.language === "string" && p.language.trim()) {
      return { language: p.language.trim(), path: typeof p.path === "string" ? p.path.trim() : "" };
    }
  } catch { /* not JSON */ }
  return null;
}

function extractCaptionEntries(raw: unknown): CaptionEntry[] {
  let parsed = raw;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  const out: CaptionEntry[] = [];
  for (const c of parsed) {
    if (typeof c === "string" && c.trim()) {
      const unwrapped = tryUnwrapJsonEntry(c);
      if (unwrapped) { out.push(unwrapped); continue; }
      out.push({ language: c.trim(), path: "" });
      continue;
    }
    if (c && typeof c === "object") {
      const e = c as Record<string, unknown>;
      let lang = typeof e.language === "string" ? e.language.trim() : "";
      const path = typeof e.path === "string" ? e.path.trim() : "";
      if (lang && lang.startsWith("{")) {
        const unwrapped = tryUnwrapJsonEntry(lang);
        if (unwrapped) { out.push(unwrapped); continue; }
      }
      if (lang) out.push({ language: lang, path });
    }
  }
  return out;
}

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
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const sec = Math.floor(seconds);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function isSeriesFile(f: FileType): boolean {
  const t = (v: unknown) => v === true || v === 1;
  return t(f.is_series_main) || t(f.is_series_episode) || t(f.is_files_series_item);
}

type LayoutType = "default" | "horizontal" | "compact" | "reelStrip" | "shelf" | "endCard" | "endCardHorizontal" | "notificationThumb" | "studioRow";

interface VideoCardProps {
  data: FileType;
  index?: number;
  currentUserId?: string;
  userActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
  onUpdate?: (fileId: string, updates: Partial<FileType>) => void;
  showOwnerControls?: boolean;
  related?: boolean;
  layout?: LayoutType;
  /** Passed to `VideoCard/Actions`: default row vs reel-style stack vs shelf ⋮-only menu. */
  actionsLayout?: "default" | "reel" | "tiktok" | "shortsShelf";
  /** When set (e.g. watch page sidebar), show add-to-play-queue on horizontal cards. */
  onAddToPlayQueue?: (video: FileType) => void;
  inPlayQueue?: boolean;
  /** Hide like/share/⋯ row  use on watch sidebar, queue, playlists, series lists (YouTube-style). */
  hideActions?: {
    halfway?: boolean;
    completely?: boolean;
  };
  /** 0–1 = red progress strip along bottom of thumbnail (YouTube queue style). */
  thumbnailProgress?: number;
  /** Owner-only delete callback. When set, the ⋯ menu shows a Delete item. */
  onDelete?: (file: FileType) => void;
}

const CATEGORIES = ["Gaming", "Music", "Entertainment", "Education", "Technology", "Sports", "News", "Lifestyle", "Anime", "Film", "Automotive", "Art", "Nature", "Other"];

const VideoCard = ({
  data,
  index,
  currentUserId,
  userActions,
  onUpdate,
  showOwnerControls,
  related,
  layout = "default",
  actionsLayout,
  onAddToPlayQueue,
  inPlayQueue,
  hideActions = {
    halfway: false,
    completely: false,
  },
  thumbnailProgress,
  onDelete,
}: VideoCardProps) => {
  const isMobile = useIsMobile();
  const sidebarCtx = useSidebarOptional();
  const sidebarLayoutState = sidebarCtx?.state ?? "expanded";
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
  const processingProgressPct = useMemo(() => {
    const r = data.processing_progress;
    if (r == null) return null;
    const n = typeof r === "number" ? r : Number(r);
    if (!Number.isFinite(n)) return null;
    return Math.min(100, Math.max(0, Math.round(n)));
  }, [data.processing_progress]);
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
  const [editCaptions, setEditCaptions] = useState<CaptionEntry[]>(() =>
    extractCaptionEntries(data.captions),
  );
  const [captionModalOpen, setCaptionModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [infoModalOpen, setInfoModalOpen] = useState(false);

  /**
   * Skip-intro / next-episode markers  owner sets these on their own video and every viewer's
   * player picks them up from `metadata.markers`. Stored as `m:ss` or `h:mm:ss` strings while
   * editing for human readability; converted to seconds on save.
   */
  const initialMarkers = useMemo(() => {
    const meta = data.metadata;
    if (!meta || typeof meta !== "object") return null;
    const m = (meta as Record<string, unknown>).markers;
    if (!m || typeof m !== "object") return null;
    return m as { introStart?: number | null; introEnd?: number | null; creditsStart?: number | null };
  }, [data.metadata]);
  const formatMarker = (s: number | null | undefined): string => {
    if (s == null || !Number.isFinite(s) || s < 0) return "";
    const total = Math.floor(s);
    const hh = Math.floor(total / 3600);
    const mm = Math.floor((total % 3600) / 60);
    const ss = total % 60;
    if (hh > 0) {
      return `${hh}:${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
    }
    return `${mm}:${ss.toString().padStart(2, "0")}`;
  };
  const parseMarker = (input: string): number | null | undefined => {
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      const n = Number(trimmed);
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    }
    // Accept `h:mm:ss[.ms]` (hours optional) or `m:ss[.ms]`. When hours are present,
    // minutes must be 0–59; without hours the first group is "total minutes" so 100+ is allowed.
    const m = trimmed.match(/^(?:(\d{1,3}):)?(\d{1,3}):([0-5]?\d)(?:\.(\d+))?$/);
    if (!m) return undefined;
    const hours = m[1] ? Number(m[1]) : 0;
    const mins = Number(m[2]);
    const secs = Number(m[3]);
    const frac = m[4] ? Number(`0.${m[4]}`) : 0;
    if (m[1] && mins >= 60) return undefined;
    return hours * 3600 + mins * 60 + secs + frac;
  };
  const [editIntroStart, setEditIntroStart] = useState(formatMarker(initialMarkers?.introStart));
  const [editIntroEnd, setEditIntroEnd] = useState(formatMarker(initialMarkers?.introEnd));
  const [editCreditsStart, setEditCreditsStart] = useState(formatMarker(initialMarkers?.creditsStart));
  const nav = useNavigate();
  const watchPath = useMemo(
    () => fileWatchPath(data),
    [data.is_reel, data.id, data.unique_id],
  );

  /**
   * Series-main click: ask the server for the user's most recently watched episode in this
   * series and jump straight there. Falls back to the series main page when there's no
   * resume target (guest, never watched, network failure). Other files navigate normally.
   */
  const seriesResumeNav = useCallback(async () => {
    const sid = data.file_series_id;
    const suid = data.unique_id;
    const sfid = data.id;
    const isSeriesMain = data.is_series_main === true || (data.is_series_main as unknown) === 1;
    if (!isSeriesMain) return null;
    try {
      const params = new URLSearchParams();
      if (sid) params.set('seriesId', sid);
      if (suid) params.set('seriesUniqueId', suid);
      if (sfid) params.set('seriesFileId', sfid);
      const res = await fetch(`/api/series/resume?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        resume?: { uniqueId?: string; currentTime?: number } | null;
      };
      const uid = json?.resume?.uniqueId;
      if (uid && typeof uid === 'string') {
        const t = Number(json?.resume?.currentTime);
        if (Number.isFinite(t) && t > 0) {
          return `/${encodeURIComponent(uid)}?t=${encodeURIComponent(String(Math.floor(t)))}`;
        }
        return `/${encodeURIComponent(uid)}`;
      }
      return null;
    } catch {
      return null;
    }
  }, [data.file_series_id, data.is_series_main]);

  const handleWatchNav = useCallback(async () => {
    const resume = await seriesResumeNav();
    nav(resume ?? watchPath);
  }, [seriesResumeNav, nav, watchPath]);
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

  // --- Series editing state ---
  /** Snapshot of the file's current series state, loaded from /api/file-series. */
  const [seriesState, setSeriesState] = useState<{
    is_series_main: boolean;
    is_files_series_item: boolean;
    file_series_id: string | null;
    file_series_episode_id: string | null;
    series_title: string | null;
    episode_name: string | null;
  } | null>(null);
  const [seriesStateLoading, setSeriesStateLoading] = useState(false);
  /** Draft selection while the dialog is open (only applied on Save). */
  const [seriesMode, setSeriesMode] = useState<"none" | "create" | "existing">("none");
  const [seriesEpisodeName, setSeriesEpisodeName] = useState("");
  const [seriesSelected, setSeriesSelected] = useState<{
    file_series_id: string;
    file_title: string;
  } | null>(null);
  const [seriesEpisodeSubmode, setSeriesEpisodeSubmode] = useState<"existing" | "new" | null>(null);
  const [seriesEpisodeId, setSeriesEpisodeId] = useState<string | null>(null);
  const [seriesParentEpisodeId, setSeriesParentEpisodeId] = useState<string | null>(null);
  const [seriesEpisodesList, setSeriesEpisodesList] = useState<
    { id: string; episode_name: string; parent_episode_id: string | null }[]
  >([]);
  // Browse dialog
  const [seriesBrowseOpen, setSeriesBrowseOpen] = useState(false);
  const [seriesSearch, setSeriesSearch] = useState("");
  const [seriesBrowseResults, setSeriesBrowseResults] = useState<{ file_title: string; file_series_id: string }[]>([]);
  const [seriesBrowseLoading, setSeriesBrowseLoading] = useState(false);
  const [isSeriesBusy, setIsSeriesBusy] = useState(false);
  const [seriesEpisodesPreviewOpen, setSeriesEpisodesPreviewOpen] = useState(false);

  /** Series is available on any file the viewer owns. */
  const canManageSeries = isOwner;

  const catDropdownRef = useRef<HTMLDivElement>(null);

  const metadataWarning = getMetadataWarning(data.metadata);
  const commentCount = Number(data.comment_count) || 0;
  const viewCount = Number(data.view_count ?? data.views) || 0;
  /** Feed / DB may return duration as string; coerce so the badge and meta row always show. */
  const durationSec = useMemo(() => {
    const d = Number(data.duration);
    return Number.isFinite(d) && d > 0 ? d : 0;
  }, [data.duration]);

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
    setEditIntroStart(formatMarker(initialMarkers?.introStart));
    setEditIntroEnd(formatMarker(initialMarkers?.introEnd));
    setEditCreditsStart(formatMarker(initialMarkers?.creditsStart));
    setEditCaptions(extractCaptionEntries(data.captions));
  }, [
    isEditing,
    data.file_title,
    data.file_description,
    data.is_public,
    data.categories,
    data.tags,
    data.comments_enabled,
    data.comment_limit,
    data.captions,
    initialMarkers,
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
        setEditCaptions(extractCaptionEntries(f.captions));
        if (Object.prototype.hasOwnProperty.call(f, "default_thumbnail")) {
          const dt = f.default_thumbnail;
          setEditLoadedDefaultThumb(typeof dt === "string" ? dt : dt == null ? null : undefined);
        }
        const meta = f.metadata;
        if (meta && typeof meta === "object") {
          const mk = (meta as Record<string, unknown>).markers as
            | { introStart?: number | null; introEnd?: number | null; creditsStart?: number | null }
            | undefined;
          if (mk) {
            setEditIntroStart(formatMarker(mk.introStart));
            setEditIntroEnd(formatMarker(mk.introEnd));
            setEditCreditsStart(formatMarker(mk.creditsStart));
          }
        }
      } catch {
        if (!cancelled) setEditError("Could not load the latest file settings.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEditing, isOwner, data.id, data.unique_id]);

  // Brozy Studio keeps Actions in a separate table column; open the same edit dialog.
  useEffect(() => {
    if (layout !== "studioRow" || !isOwner) return;
    const onOpen = (e: Event) => {
      const uid = (e as CustomEvent<{ uniqueId?: string }>).detail?.uniqueId;
      if (uid && uid === data.unique_id) setIsEditing(true);
    };
    window.addEventListener(VIDEOCARD_OPEN_EDIT_EVENT, onOpen);
    return () => window.removeEventListener(VIDEOCARD_OPEN_EDIT_EVENT, onOpen);
  }, [layout, isOwner, data.unique_id]);

  // Load series state whenever the edit dialog opens for a file owned by the user.
  useEffect(() => {
    if (!isEditing || !canManageSeries) {
      setSeriesState(null);
      return;
    }
    const fid = data.id || data.unique_id;
    if (!fid) return;
    let cancelled = false;
    setSeriesStateLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/file-series?fileId=${encodeURIComponent(String(fid))}`, {
          credentials: "include",
        });
        const j = (await res.json().catch(() => null)) as {
          success?: boolean;
          state?: {
            is_series_main: boolean;
            is_files_series_item: boolean;
            file_series_id: string | null;
            file_series_episode_id: string | null;
            series_title: string | null;
            episode_name: string | null;
          };
        } | null;
        if (cancelled) return;
        if (res.ok && j?.success && j.state) {
          setSeriesState(j.state);
        } else {
          setSeriesState(null);
        }
      } catch {
        if (!cancelled) setSeriesState(null);
      } finally {
        if (!cancelled) setSeriesStateLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEditing, canManageSeries, data.id, data.unique_id]);

  // Reset the draft series selection whenever the dialog opens/closes.
  useEffect(() => {
    if (!isEditing) {
      setSeriesMode("none");
      setSeriesEpisodeName("");
      setSeriesSelected(null);
      setSeriesEpisodeSubmode(null);
      setSeriesEpisodeId(null);
      setSeriesParentEpisodeId(null);
      setSeriesEpisodesList([]);
      setSeriesBrowseOpen(false);
      setSeriesSearch("");
    }
  }, [isEditing]);

  // Search user's series from the browse dialog.
  useEffect(() => {
    if (!seriesBrowseOpen) return;
    setSeriesBrowseLoading(true);
    const t = setTimeout(() => {
      void (async () => {
        try {
          const q = encodeURIComponent(seriesSearch.trim());
          const res = await fetch(`/api/my-series?q=${q}`, { credentials: "include" });
          const j = await res.json().catch(() => ({}));
          if (res.ok && Array.isArray(j.series)) {
            setSeriesBrowseResults(j.series);
          } else {
            setSeriesBrowseResults([]);
          }
        } catch {
          setSeriesBrowseResults([]);
        } finally {
          setSeriesBrowseLoading(false);
        }
      })();
    }, 280);
    return () => clearTimeout(t);
  }, [seriesSearch, seriesBrowseOpen]);

  const loadEpisodesForSelectedSeries = useCallback((fileSeriesId: string) => {
    void (async () => {
      try {
        const res = await fetch(
          `/api/series-episodes?file_series_id=${encodeURIComponent(fileSeriesId)}`,
          { credentials: "include" }
        );
        const j = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const list = Array.isArray(j.episodes)
          ? (j.episodes as {
              id: string;
              episode_name: string;
              parent_episode_id?: string | null;
            }[])
          : [];
        setSeriesEpisodesList(
          list.map((e) => ({
            id: e.id,
            episode_name: e.episode_name,
            parent_episode_id:
              e.parent_episode_id != null && String(e.parent_episode_id).trim() !== ""
                ? String(e.parent_episode_id)
                : null,
          }))
        );
        setSeriesEpisodeSubmode(list.length > 0 ? "existing" : "new");
        setSeriesEpisodeId(null);
        setSeriesEpisodeName("");
        setSeriesParentEpisodeId(null);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const openSeriesBrowse = () => {
    setSeriesSearch("");
    setSeriesBrowseOpen(true);
  };

  /** Any pending change in the series draft vs. the loaded state? */
  const seriesHasDraftChange = seriesMode !== "none";

  /** Submit the series draft. Returns true on success or no-op. */
  const applySeriesChangeIfAny = useCallback(async (): Promise<boolean> => {
    if (!canManageSeries) return true;
    if (!seriesHasDraftChange) return true;
    if (!data.id && !data.unique_id) return true;

    const fileId = data.id || data.unique_id;
    setIsSeriesBusy(true);
    try {
      let body: Record<string, unknown> | null = null;
      if (seriesMode === "create") {
        const name = seriesEpisodeName.trim();
        if (!name) {
          setEditError("Please enter an episode name for the new series.");
          return false;
        }
        body = {
          action: "assign",
          fileId,
          isNewSeries: true,
          newEpisodeName: name,
        };
      } else if (seriesMode === "existing") {
        if (!seriesSelected?.file_series_id) {
          setEditError("Please choose a series.");
          return false;
        }
        const base: Record<string, unknown> = {
          action: "assign",
          fileId,
          fileSeriesId: seriesSelected.file_series_id,
        };
        if (seriesEpisodeSubmode === "existing") {
          if (!seriesEpisodeId) {
            setEditError("Please choose an episode.");
            return false;
          }
          base.fileSeriesEpisodeId = seriesEpisodeId;
        } else if (seriesEpisodeSubmode === "new") {
          const name = seriesEpisodeName.trim();
          if (!name) {
            setEditError("Please enter a name for the new episode.");
            return false;
          }
          base.newEpisodeName = name;
          if (seriesParentEpisodeId) {
            base.parentEpisodeId = seriesParentEpisodeId;
          }
        } else {
          setEditError("Please choose an existing episode or create a new one.");
          return false;
        }
        body = base;
      }

      if (!body) return true;

      const res = await fetch("/api/file-series", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.success) {
        setEditError(j?.error || "Failed to update series membership.");
        return false;
      }
      if (j.state) setSeriesState(j.state);
      if (onUpdate && data.id) {
        onUpdate(data.id, {
          is_series_main: j.state?.is_series_main,
          is_files_series_item: j.state?.is_files_series_item,
          file_series_id: j.state?.file_series_id,
          file_series_episode_id: j.state?.file_series_episode_id,
        });
      }
      return true;
    } catch {
      setEditError("Failed to update series membership.");
      return false;
    } finally {
      setIsSeriesBusy(false);
    }
  }, [
    canManageSeries,
    seriesHasDraftChange,
    seriesMode,
    seriesEpisodeName,
    seriesSelected,
    seriesEpisodeSubmode,
    seriesEpisodeId,
    seriesParentEpisodeId,
    data.id,
    data.unique_id,
    onUpdate,
  ]);

  const removeFileFromSeries = useCallback(async () => {
    if (!data.id && !data.unique_id) return;
    const fileId = data.id || data.unique_id;
    setIsSeriesBusy(true);
    setEditError(null);
    try {
      const res = await fetch("/api/file-series", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unassign", fileId }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.success) {
        setEditError(j?.error || "Failed to remove file from series.");
        return;
      }
      if (j.state) setSeriesState(j.state);
      if (onUpdate && data.id) {
        onUpdate(data.id, {
          is_series_main: false,
          is_files_series_item: false,
          file_series_id: null,
          file_series_episode_id: null,
        });
      }
    } catch {
      setEditError("Failed to remove file from series.");
    } finally {
      setIsSeriesBusy(false);
    }
  }, [data.id, data.unique_id, onUpdate]);

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
      // Apply series change first  if this fails we surface the error and stop
      // before touching any other file fields.
      if (seriesHasDraftChange) {
        const seriesOk = await applySeriesChangeIfAny();
        if (!seriesOk) {
          setIsSaving(false);
          return;
        }
      }

      let newDefaultThumbnail: string | undefined;

      // Images use their own endpoint as thumbnail  no thumbnail editing allowed
      if (!data.file_type?.startsWith("image/") && customThumbFile) {
        setIsUploadingThumb(true);
        try {
          const formData = new FormData();
          formData.append("file", customThumbFile);
          formData.append("file_id", data.id as string);

          const thumbRes = await fetch("/api/upload/thumbnail", {
            method: "POST",
            credentials: "include",
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

      /** Markers: validate format + relationship before submitting. `undefined` parse = bad format. */
      const introStartParsed = parseMarker(editIntroStart);
      const introEndParsed = parseMarker(editIntroEnd);
      const creditsStartParsed = parseMarker(editCreditsStart);
      if (introStartParsed === undefined) {
        setEditError("Intro start must be empty, a number of seconds, m:ss, or h:mm:ss.");
        setIsSaving(false);
        return;
      }
      if (introEndParsed === undefined) {
        setEditError("Intro end must be empty, a number of seconds, m:ss, or h:mm:ss.");
        setIsSaving(false);
        return;
      }
      if (creditsStartParsed === undefined) {
        setEditError("Credits start must be empty, a number of seconds, m:ss, or h:mm:ss.");
        setIsSaving(false);
        return;
      }
      if (
        typeof introStartParsed === "number" &&
        typeof introEndParsed === "number" &&
        introEndParsed <= introStartParsed
      ) {
        setEditError("Intro end must be after intro start.");
        setIsSaving(false);
        return;
      }
      const markersPayload = {
        introStart: introStartParsed,
        introEnd: introEndParsed,
        creditsStart: creditsStartParsed,
      };

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
          markers: markersPayload,
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
          /** Push the merged metadata back so the player picks up the new markers without a refresh. */
          ...(payload.file.metadata !== undefined ? { metadata: payload.file.metadata } : {}),
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

  /** Same resolution order as `getThumbnailUrl` before the legacy thumbnail_*.jpg fallback  avoids a blank poster only when we know a real asset exists (matches Dynamic watch placeholder). */
  const hasKnownThumbnailSource = useMemo(() => {
    if (data.file_type?.startsWith("image/") && data.endpoint) return true;
    if (getDefaultThumbnail(data.default_thumbnail ?? null)) return true;
    if (Array.isArray(data.thumbnails) && data.thumbnails.length > 0) {
      const hasFrame = data.thumbnails.some(
        (t) => typeof t === "string" && (/\/thumb_\d+\.jpg$/i.test(t) || /^thumb_\d+\.jpg$/i.test(t)),
      );
      if (hasFrame) return true;
      const hasPreview = data.thumbnails.some(
        (t) =>
          typeof t === "string" &&
          (t.endsWith("/thumbnail_preview.jpg") || t === "thumbnail_preview.jpg"),
      );
      if (hasPreview) return true;
    }
    return false;
  }, [data.file_type, data.endpoint, data.default_thumbnail, data.thumbnails]);

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

  const renderThumbnail = (className?: string) => {
    const isSeriesMain = data.is_series_main === true || (data.is_series_main as unknown) === 1;
    return (
    <div className={`relative ${className || ""}`}>
      {isSeriesMain && (
        <>
          {/**
           * Stacked-card depth so the series cover reads as "a collection of episodes," not just
           * one video. Two offset rectangles peek out behind the main thumbnail; pointer-events
           * are off so they never steal a click from the wrapping Link.
           */}
          <div
            aria-hidden
            className="pointer-events-none absolute -right-1 -top-1 z-0 h-[calc(100%-0.5rem)] w-[calc(100%-0.5rem)] translate-x-1.5 -translate-y-1 rounded-lg bg-card/90 ring-1 ring-border/40 shadow-sm dark:bg-zinc-800/80 dark:ring-white/10"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-0.5 -top-0.5 z-0 h-[calc(100%-0.25rem)] w-[calc(100%-0.25rem)] translate-x-0.5 -translate-y-0.5 rounded-lg bg-card ring-1 ring-border/50 shadow dark:bg-zinc-900 dark:ring-white/10"
          />
        </>
      )}
      {data.is_adult && <AdultContentBadge />}
      {isSeriesMain ? (
        <button
          type="button"
          className="absolute left-2 top-2 z-[100] inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/80 bg-card/95 text-foreground shadow-sm ring-1 ring-border/50 backdrop-blur-sm transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-zinc-900/95 dark:ring-white/10"
          aria-label="Browse series episodes"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setSeriesEpisodesPreviewOpen(true);
          }}
        >
          <ListVideo className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
        </button>
      ) : isSeriesFile(data) ? (
        <div
          className="pointer-events-none absolute left-2 top-2 z-[100] inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/70 bg-muted/90 text-foreground shadow-sm ring-1 ring-border/40 backdrop-blur-sm dark:bg-zinc-900/90 dark:border-white/10"
          aria-hidden
        >
          <ListVideo className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
        </div>
      ) : null}
      {data.is_reel && (
        <div
          className="pointer-events-none absolute right-2 top-2 z-[100] inline-flex items-center justify-center rounded-full text-shadow-lg"
          aria-label="Reel"
        >
          <Clapperboard className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
        </div>
      )}
      <motion.div
        transition={{ duration: 0.1, ease: "easeOut", damping: 10, stiffness: 100 }}
        className="w-full h-full"
      >
        {!error && (!isPending || hasKnownThumbnailSource) ? (
          <div className="relative h-full w-full">
            <ImageLoad
              link={thumbnailLink}
              imageID={data.unique_id}
              index={index}
              retry={handleRetry}
              className="w-full h-full object-cover transition-all duration-300"
              callBack={handleImageLoaded}
              quality={60}
              hasAdultTag={Boolean(data.is_adult)}
            />
            {isPending && (
              <>
                <div
                  className="pointer-events-none absolute inset-0 z-[15] bg-gradient-to-t from-black/85 via-black/25 to-transparent"
                  aria-hidden
                />
                <div className="absolute bottom-0 left-0 right-0 z-[16] space-y-2 p-3">
                  {isOwner &&
                  processingProgressPct != null ? (
                    <>
                      <div className="flex items-center justify-between text-[11px] font-medium tabular-nums text-white/95 sm:text-xs">
                        <span>Processing</span>
                        <span>{processingProgressPct}%</span>
                      </div>
                      <div
                        className="h-2 w-full overflow-hidden rounded-full bg-white/20"
                        role="progressbar"
                        aria-valuenow={processingProgressPct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
                          style={{ width: `${processingProgressPct}%` }}
                        />
                      </div>
                    </>
                  ) : (
                    <p className="text-[11px] font-medium leading-snug text-white drop-shadow-sm sm:text-xs">
                      This video is still processing. Check back shortly.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-muted px-3 py-4 text-xs text-center text-muted-foreground">
            {isPending ? (
              <>
                <span className="font-medium text-foreground">
                  {processingProgressPct != null
                    ? `Processing ${processingProgressPct}%`
                    : "Processing upload…"}
                </span>
                {processingProgressPct != null ? (
                  <Progress
                    value={processingProgressPct}
                    className="h-1.5 w-[min(100%,12rem)] max-w-full bg-muted-foreground/15"
                  />
                ) : (
                  <div
                    className="h-1.5 w-[min(100%,12rem)] max-w-full overflow-hidden rounded-full bg-muted-foreground/15"
                    role="progressbar"
                    aria-busy="true"
                    aria-label="Processing, progress unknown"
                  >
                    <div className="h-full w-full origin-center animate-pulse rounded-full bg-primary/45" />
                  </div>
                )}
              </>
            ) : (
              <span>Failed to load image</span>
            )}
          </div>
        )}
        {layout === "default" && <CategoryBadges categories={data.categories} />}
        {durationSec > 0 && (
          <div
            className="file_duration pointer-events-none absolute right-2 bottom-2 z-20 flex min-h-[1.375rem] items-center rounded-md border border-white/10 bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums leading-none text-white shadow-sm backdrop-blur-sm"
            aria-label={`Duration ${formatDuration(durationSec)}`}
          >
            {formatDuration(durationSec)}
          </div>
        )}
        {thumbnailProgress != null &&
          Number.isFinite(thumbnailProgress) &&
          thumbnailProgress > 0 && (
            <div
              className="pointer-events-none absolute bottom-0 left-0 right-0 z-[21] h-[3px] bg-black/55"
              aria-hidden
            >
              <div
                className="h-full bg-destructive"
                style={{ width: `${Math.min(100, Math.max(0, thumbnailProgress * 100))}%` }}
              />
            </div>
          )}
        {!isPending && (
          thumbnailProgress != null &&
          Number.isFinite(thumbnailProgress) &&
          thumbnailProgress > 0 ? null : (
            <WatchProgressBar fileId={data.id ?? data.unique_id} fallbackDuration={durationSec} />
          )
        )}
      </motion.div>
    </div>
    );
  };

  const renderEditDialog = () => (
    <>
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

          {/**
           * Skip-intro / next-episode markers. Only meaningful for media with a timeline,
           * so we hide it for image files. Stored in `metadata.markers` and read by every
           * viewer's player from the same file row  Netflix-style.
           */}
          {typeof data.file_type === "string" && !data.file_type.startsWith("image/") && (
            <div className="space-y-2.5 rounded-lg border border-border/50 bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">Skip markers</span>
                <span className="text-[11px] text-muted-foreground/70">
                  Format: <code>seconds</code>, <code>m:ss</code>, or <code>h:mm:ss</code>
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">Intro start</label>
                  <Input
                    value={editIntroStart}
                    onChange={(e) => setEditIntroStart(e.target.value)}
                    placeholder="0:15"
                    disabled={isSaving}
                    className="bg-muted/50 font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">Intro end</label>
                  <Input
                    value={editIntroEnd}
                    onChange={(e) => setEditIntroEnd(e.target.value)}
                    placeholder="1:30"
                    disabled={isSaving}
                    className="bg-muted/50 font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">Credits start</label>
                  <Input
                    value={editCreditsStart}
                    onChange={(e) => setEditCreditsStart(e.target.value)}
                    placeholder="1:42:10"
                    disabled={isSaving}
                    className="bg-muted/50 font-mono"
                  />
                </div>
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground/80">
                Viewers see a "Skip Intro" button between Intro start and end, and "Next Episode"
                from Credits start onward. Leave blank to disable.
              </p>
            </div>
          )}

          {/* Add to series  available on every file the viewer owns */}
          {canManageSeries && (
            <div className="space-y-2.5 rounded-lg border border-border/50 bg-muted/20 p-3">
              <div className="flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Series</span>
              </div>

              {seriesStateLoading ? (
                <p className="text-[11px] text-muted-foreground flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Loading series info…
                </p>
              ) : seriesState?.is_series_main ? (
                <div className="space-y-1.5 rounded-lg border border-border/50 bg-background px-3 py-2 text-xs">
                  <p className="font-medium">This file is a series cover.</p>
                  <p className="text-muted-foreground">
                    {seriesState.series_title ? `Series: ${seriesState.series_title}` : "Series owned by you."}
                  </p>
                  <p className="text-[10px] text-muted-foreground/70">
                    Managing or deleting a series cover is not available from this dialog.
                  </p>
                </div>
              ) : seriesState?.is_files_series_item ? (
                <div className="space-y-2">
                  <div className="rounded-lg border border-border/50 bg-background px-3 py-2 text-xs space-y-0.5">
                    <p className="font-medium truncate">
                      {seriesState.series_title || "Series"}
                    </p>
                    {seriesState.episode_name && (
                      <p className="text-muted-foreground truncate">
                        Episode: {seriesState.episode_name}
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 w-full"
                    disabled={isSaving || isSeriesBusy}
                    onClick={removeFileFromSeries}
                  >
                    {isSeriesBusy ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Removing…
                      </span>
                    ) : (
                      "Remove from series"
                    )}
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    {(["none", "create", "existing"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        disabled={isSaving || isSeriesBusy}
                        onClick={() => {
                          if (mode === "none") {
                            setSeriesMode("none");
                            setSeriesEpisodeName("");
                            setSeriesSelected(null);
                            setSeriesEpisodeSubmode(null);
                            setSeriesEpisodeId(null);
                            setSeriesEpisodesList([]);
                          } else if (mode === "create") {
                            setSeriesMode("create");
                            setSeriesSelected(null);
                            setSeriesEpisodeSubmode(null);
                            setSeriesEpisodeId(null);
                            setSeriesEpisodesList([]);
                          } else {
                            setSeriesMode("existing");
                            setSeriesEpisodeName("");
                            setSeriesEpisodeId(null);
                            setSeriesEpisodesList([]);
                            setSeriesEpisodeSubmode(null);
                          }
                        }}
                        className={`text-left rounded-lg px-3 py-2 text-sm transition-colors disabled:opacity-50 ${
                          seriesMode === mode
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted/50 hover:bg-muted/80 text-foreground"
                        }`}
                      >
                        {mode === "none" && "Not in a series"}
                        {mode === "create" && "Create new series (this file is the cover)"}
                        {mode === "existing" && "Add to existing series"}
                      </button>
                    ))}
                  </div>

                  {seriesMode === "create" && (
                    <div className="space-y-1.5 pt-1">
                      <label className="text-xs font-medium text-muted-foreground">Episode name</label>
                      <Input
                        value={seriesEpisodeName}
                        onChange={(e) => setSeriesEpisodeName(e.target.value)}
                        placeholder="e.g. Episode 1"
                        maxLength={500}
                        disabled={isSaving || isSeriesBusy}
                        className="text-sm h-9 bg-muted/30 border-border/50"
                      />
                      <p className="text-[10px] text-muted-foreground/70">
                        The first episode for this series (this file is the cover and the first episode).
                      </p>
                    </div>
                  )}

                  {seriesMode === "existing" && (
                    <div className="space-y-2 pt-1">
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[11px] text-muted-foreground">Series</span>
                        {seriesSelected ? (
                          <div className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-background px-3 py-2 text-sm">
                            <span className="truncate">{seriesSelected.file_title || "Series"}</span>
                            <button
                              type="button"
                              disabled={isSaving || isSeriesBusy}
                              onClick={openSeriesBrowse}
                              className="text-xs text-primary shrink-0 hover:underline"
                            >
                              Change
                            </button>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-9"
                            disabled={isSaving || isSeriesBusy}
                            onClick={openSeriesBrowse}
                          >
                            Choose series…
                          </Button>
                        )}
                      </div>

                      {seriesSelected && (
                        <>
                          <div className="flex rounded-lg border border-border/50 overflow-hidden bg-muted/30">
                            <button
                              type="button"
                              disabled={isSaving || isSeriesBusy || seriesEpisodesList.length === 0}
                              onClick={() => {
                                setSeriesEpisodeSubmode("existing");
                                setSeriesEpisodeName("");
                                setSeriesParentEpisodeId(null);
                              }}
                              className={`flex-1 py-2 text-xs font-medium transition-colors disabled:opacity-40 ${
                                seriesEpisodeSubmode === "existing"
                                  ? "bg-primary text-primary-foreground"
                                  : "text-muted-foreground"
                              }`}
                            >
                              Existing episode
                            </button>
                            <button
                              type="button"
                              disabled={isSaving || isSeriesBusy}
                              onClick={() => {
                                setSeriesEpisodeSubmode("new");
                                setSeriesEpisodeId(null);
                                setSeriesParentEpisodeId(null);
                              }}
                              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                                seriesEpisodeSubmode === "new"
                                  ? "bg-primary text-primary-foreground"
                                  : "text-muted-foreground"
                              }`}
                            >
                              New episode
                            </button>
                          </div>

                          {seriesEpisodeSubmode === "existing" && seriesEpisodesList.length > 0 && (
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-muted-foreground">Episode</label>
                              <EpisodePicker
                                episodes={seriesEpisodesList}
                                value={seriesEpisodeId}
                                onChange={(id) => setSeriesEpisodeId(id)}
                                placeholder="Select episode…"
                                disabled={isSaving || isSeriesBusy}
                                triggerAriaLabel="Select episode"
                              />
                            </div>
                          )}

                          {seriesEpisodeSubmode === "new" && (
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-muted-foreground">
                                New episode name
                              </label>
                              <Input
                                value={seriesEpisodeName}
                                onChange={(e) => setSeriesEpisodeName(e.target.value)}
                                placeholder="Episode name"
                                maxLength={500}
                                disabled={isSaving || isSeriesBusy}
                                className="text-sm h-9 bg-muted/30 border-border/50"
                              />
                              {seriesEpisodesList.length > 0 && (
                                <div className="space-y-1.5 pt-0.5">
                                  <label className="text-xs font-medium text-muted-foreground">
                                    Nest under (optional)
                                  </label>
                                  <EpisodePicker
                                    episodes={seriesEpisodesList}
                                    value={seriesParentEpisodeId}
                                    onChange={(id) => setSeriesParentEpisodeId(id)}
                                    placeholder="Choose parent…"
                                    noneLabel="Top-level episode"
                                    disabled={isSaving || isSeriesBusy}
                                    triggerAriaLabel="Nest under episode"
                                  />
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

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
          {/* Thumbnail selector  only for video/audio, not images */}
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

          {!data.file_type?.startsWith("image/") && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Captions</label>
              <button
                type="button"
                onClick={() => setCaptionModalOpen(true)}
                disabled={isSaving}
                className="w-full flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
              >
                <Captions className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 text-left">
                  {editCaptions.length === 0
                    ? "Add captions"
                    : `${editCaptions.length} track${editCaptions.length === 1 ? "" : "s"}`}
                </span>
                {editCaptions.length > 0 && (
                  <span className="text-[10px] text-muted-foreground truncate max-w-[40%]">
                    {editCaptions.map((c) => findLanguageLabel(c.language) || c.language).join(", ")}
                  </span>
                )}
              </button>
            </div>
          )}

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
                        Review accepted  adult flag has been removed.
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

    <CaptionModal
      open={captionModalOpen}
      onOpenChange={setCaptionModalOpen}
      fileId={String(data.id || "")}
      initialCaptions={editCaptions}
      onCaptionsChange={setEditCaptions}
      duration={typeof data.duration === "number" ? data.duration : undefined}
      disabled={isSaving}
    />

    {/* Series browse dialog  owner can pick one of their existing series */}
    <Dialog open={seriesBrowseOpen} onOpenChange={setSeriesBrowseOpen}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">Your series</DialogTitle>
        </DialogHeader>
        <Input
          value={seriesSearch}
          onChange={(e) => setSeriesSearch(e.target.value)}
          placeholder="Search by title…"
          className="h-9 text-sm"
        />
        <div className="max-h-[240px] overflow-y-auto rounded-lg border border-border/50 divide-y divide-border/50">
          {seriesBrowseLoading ? (
            <p className="p-4 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading…
            </p>
          ) : seriesBrowseResults.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No series match your search.</p>
          ) : (
            seriesBrowseResults.map((row) => (
              <button
                key={row.file_series_id}
                type="button"
                className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted/80 transition-colors"
                onClick={() => {
                  setSeriesMode("existing");
                  setSeriesSelected({
                    file_series_id: row.file_series_id,
                    file_title: row.file_title,
                  });
                  loadEpisodesForSelectedSeries(row.file_series_id);
                  setSeriesBrowseOpen(false);
                }}
              >
                <span className="font-medium line-clamp-2">{row.file_title || "Untitled"}</span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
    </>
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


  const renderActions = () => (
    <>
      {!hideActions.completely ? (
        <div className="ac_dev w-full">
          {hideActions.halfway ? null : <Separator className="my-2" />}
          <Actions
            layout={actionsLayout}
            fileId={data.id ?? ""}
            uniqueId={data.unique_id}
            sharePagePath={watchPath}
            likeCount={likeCount}
            dislikeCount={dislikeCount}
            commentCount={commentCount}
            liked={liked}
            disliked={disliked}
            isOwner={isOwner}
            onEdit={isOwner ? () => setIsEditing(true) : undefined}
            onDelete={isOwner && onDelete ? () => onDelete(data) : undefined}
            onUpdate={currentUserId ? handleInteractionUpdate : undefined}
            currentUserId={currentUserId}
            fileCreatedAt={data.created_at}
            fileOwnerId={data.owner_id}
            howLikesDislikeComments={hideActions.halfway ? false : true}
          />
        </div>
      ) : null}
    </>
  )

  const isSeriesMainCard =
    data.is_series_main === true || (data.is_series_main as unknown) === 1;

  const seriesEpisodesPreviewDialogEl = isSeriesMainCard ? (
    <SeriesEpisodesPreviewDialog
      open={seriesEpisodesPreviewOpen}
      onOpenChange={setSeriesEpisodesPreviewOpen}
      uniqueId={data.unique_id?.trim() ? data.unique_id : null}
      seriesTitle={data.file_title}
      fileSeriesId={data.file_series_id != null ? String(data.file_series_id) : null}
      currentUserId={currentUserId}
      userActions={userActions}
    />
  ) : null;

  if (layout === "shelf") {
    return (
      <div className="group/shelf relative flex w-full max-w-full flex-col overflow-hidden rounded-xl border border-border/60 bg-card/40 shadow-xs transition-[border-color,box-shadow] duration-200 hover:border-border hover:shadow-sm dark:border-white/[0.08] dark:bg-card/25 dark:hover:border-white/[0.12]">
        <Link
          onClick={(e) => {
            e.preventDefault();
            void handleWatchNav();
          }}
          to={watchPath}
          aria-label={`Open ${(data.file_title || data.filename || "video").slice(0, 80)}`}
          className="relative aspect-video w-full shrink-0 overflow-hidden bg-muted/30 outline-none ring-0 transition-[filter] duration-200 hover:brightness-[1.03] focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-0"
        >
          {renderThumbnail("aspect-video h-full w-full")}
        </Link>

        <div className="flex min-w-0 items-start gap-1.5 border-t border-border/40 px-2.5 pb-2.5 pt-2 dark:border-white/[0.06]">
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-1">
              <Link
                onClick={(e) => {
                  e.preventDefault();
                  void handleWatchNav();
                }}
                to={watchPath}
                className="min-w-0 flex-1 rounded-md hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug tracking-tight text-foreground sm:text-sm">
                  <ParseFilenameInsert filename={data.file_title || data.filename} showLimit={64} />
                </h3>
              </Link>
              {metadataWarning ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setInfoModalOpen(true);
                      }}
                      className="mt-0.5 shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                      aria-label="Content information"
                    >
                      <Info className="size-3.5 sm:size-4" aria-hidden />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[200px]" sideOffset={4}>
                    Content information
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px] leading-tight text-muted-foreground sm:text-xs">
              {data.owner && (
                <Link
                  to={`/profile/${data.owner.username}`}
                  onClick={(e) => e.stopPropagation()}
                  className="max-w-full truncate hover:text-foreground transition-colors"
                >
                  {data.owner.username}
                </Link>
              )}
              {data.owner && (viewCount > 0 || Boolean(data.created_at)) ? (
                <span className="select-none text-muted-foreground/40">·</span>
              ) : null}
              {viewCount > 0 ? <span className="tabular-nums">{formatViews(viewCount)} views</span> : null}
              {viewCount > 0 && data.created_at ? (
                <span className="select-none text-muted-foreground/40">·</span>
              ) : null}
              {data.created_at ? <span>{formatTimeAgo(data.created_at)}</span> : null}
            </div>
          </div>

          {!hideActions.completely ? (
            <div className="-mr-1 -mt-0.5 flex shrink-0 items-start justify-end">
              <Actions
                layout="shortsShelf"
                fileId={data.id ?? ""}
                uniqueId={data.unique_id}
                sharePagePath={watchPath}
                likeCount={likeCount}
                dislikeCount={dislikeCount}
                commentCount={commentCount}
                liked={liked}
                disliked={disliked}
                isOwner={isOwner}
                isAdult={Boolean(data.is_adult)}
                onEdit={isOwner ? () => setIsEditing(true) : undefined}
                onDelete={isOwner && onDelete ? () => onDelete(data) : undefined}
                onUpdate={currentUserId ? handleInteractionUpdate : undefined}
                currentUserId={currentUserId}
                fileCreatedAt={data.created_at}
                fileOwnerId={data.owner_id}
                commentsEnabled={data.comments_enabled !== false}
                howLikesDislikeComments={false}
              />
            </div>
          ) : null}
        </div>

        {renderEditDialog()}
        {renderInfoDialog()}
        {seriesEpisodesPreviewDialogEl}
      </div>
    );
  }

  if (layout === "horizontal") {
    return (
      <div
        className={cn(
          "group flex w-full transition-colors",
          !hideActions && "hover:bg-muted/50",
          hideActions ? "gap-3 rounded-lg" : "",
          sidebarLayoutState === "expanded" && "fl_break_layout text-sm gap-3 rounded-lg p-2",
          sidebarLayoutState !== "expanded" && related && "flex-row items-start gap-3 rounded-lg p-2",
          sidebarLayoutState !== "expanded" && !related && "flex-col flex-wrap gap-3 rounded-lg p-2 md:flex-row",
          hideActions && related && "p-0 hover:bg-transparent",
        )}
      >
        <Link
          onClick={(e) => {
            e.preventDefault();
            void handleWatchNav();
          }}
          to={watchPath}
          className={
            related
              ? "relative aspect-video w-38 max-w-[62%] shrink-0 overflow-hidden rounded-lg bg-card ring-1 ring-border/30 dark:ring-white/10 sm:w-42 sm:max-w-[60%]"
              : "relative aspect-video w-full min-w-60 max-w-full shrink-0 overflow-hidden rounded-lg bg-card md:max-w-64 md:flex-1"
          }
        >
          {renderThumbnail("aspect-video h-full w-full")}
        </Link>

        <div className="flex min-w-0 flex-1 flex-col justify-center py-0.5">
          <div className="flex items-start justify-between gap-2">
            <Link
              to={watchPath}
              onClick={(e) => {
                e.preventDefault();
                void handleWatchNav();
              }}
              className="min-w-0 flex-1 transition-colors hover:text-primary"
            >
              <h3 className="line-clamp-2 text-sm font-semibold leading-snug">
                <ParseFilenameInsert filename={data.file_title || data.filename} showLimit={60} />
              </h3>
            </Link>

            <div className={`max-h-[1.5rem]`}>
            {
              (hideActions.halfway) && (
                <>
                  {renderActions()}
                </>
              )
            }
          </div>

            {onAddToPlayQueue ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                    disabled={inPlayQueue}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onAddToPlayQueue(data);
                    }}
                    aria-label={inPlayQueue ? "Already in play queue" : "Add to play queue"}
                  >
                    {inPlayQueue ? (
                      <ListChecks className="h-4 w-4 text-primary" />
                    ) : (
                      <ListPlus className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">
                  {inPlayQueue ? "In play queue" : "Add to play queue"}
                </TooltipContent>
              </Tooltip>
            ) : null}
            
          </div>

          {data.owner && (
            <Link
              to={`/profile/${data.owner.username}`}
              className=" block w-fit text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              @{data.owner.username}
            </Link>
          )}

          <div className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-muted-foreground">
            {viewCount > 0 && <span>{formatViews(viewCount)} views</span>}
            {viewCount > 0 && data.created_at && <span className="text-muted-foreground/50">·</span>}
            {data.created_at && <span>{formatTimeAgo(data.created_at)}</span>}
          </div>

          <div className="z-[1000000]">
            {
              (!hideActions?.halfway) && (
                <>{renderActions()}</>
              )
            }
          </div>
        </div>

        {renderEditDialog()}
        {renderInfoDialog()}
        {seriesEpisodesPreviewDialogEl}
      </div>
    );
  }

  if (layout === "reelStrip") {
    return (
      <div className="group relative flex w-full flex-col">
        <Link
          onClick={(e) => {
            e.preventDefault();
            void handleWatchNav();
          }}
          to={watchPath}
          // in mobile let's make the reel size smaller the aspect ratio stays the same but let's minimize the size a bit 
          className="relative block aspect-[9/16] w-full shrink-0 overflow-hidden rounded-lg bg-muted outline-none ring-0 transition-opacity hover:opacity-95"
        >
          {renderThumbnail("h-full w-full")}
        </Link>

        <div className="mt-2 min-w-0 flex items-start justify-between gap-2">
          <div className="flex items-start flex-col gap-1">
            <Link
              onClick={(e) => {
                e.preventDefault();
                void handleWatchNav();
              }}
              to={watchPath}
              className="min-w-0 flex-1 hover:opacity-90"
            >
              <h3 className="line-clamp-2 text-left text-sm font-semibold leading-tight tracking-tight text-foreground">
                <ParseFilenameInsert filename={data.file_title || data.filename} showLimit={30} characterSplit={true} className={`flex flex-wrap`}/>
              </h3>
            </Link>

            {data.owner && (
                  <Link
                    to={`/profile/${data.owner.username}`}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    @{data.owner.username}
                  </Link>
                )}

            {viewCount > 0 ? (
              <p className="mt-1 text-xs leading-snug text-muted-foreground">
                {formatViews(viewCount)} views
              </p>
            ) : null}
          </div>

          <div>
            {
              (hideActions.halfway) && (
                <>
                  {renderActions()}
                </>
              )
            }
          </div>
        </div>

        {renderEditDialog()}
        {renderInfoDialog()}
        {seriesEpisodesPreviewDialogEl}
      </div>
    );
  }

  if (layout === "endCard") {
    /**
     * YouTube-style end card. Pure thumbnail + title + creator  no action
     * menus, no info dialogs, no edit dialog. Sits inside the player as an
     * overlay during the last seconds of playback; clicking navigates to the
     * suggested video.
     */
    const durationSec = typeof data.duration === "number" ? data.duration : 0;
    const durationStr = formatDuration(durationSec);
    return (
      <Link
        to={watchPath}
        onClick={(e) => {
          e.preventDefault();
          void handleWatchNav();
        }}
        // End-card cells scale with the player slot  fluid padding + clamp
        // type so cards grow on cinema layouts and stay legible on phone.
        className="group flex w-full flex-col gap-[clamp(0.25rem,1.5cqi,0.625rem)] rounded-lg p-[clamp(0.25rem,1.2cqi,0.625rem)] text-left transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        <div className="relative aspect-video w-full overflow-hidden rounded-md bg-card ring-1 ring-white/10">
          {renderThumbnail("h-full w-full")}
          {durationStr && (
            <span className="absolute right-1 bottom-1 rounded bg-black/85 px-1 py-0.5 text-[clamp(8px,2.2cqi,11px)] font-semibold tabular-nums leading-none text-white">
              {durationStr}
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-0.5 px-0.5">
          <h3 className="line-clamp-2 text-[clamp(10px,2.8cqi,15px)] font-medium leading-snug text-white">
            <ParseFilenameInsert filename={data.file_title || data.filename} showLimit={60} />
          </h3>
          <div className="flex min-w-0 flex-wrap items-center gap-x-1 text-[clamp(9px,2.4cqi,12px)] leading-tight text-white/70">
            {data.owner && (
              <span className="max-w-[10rem] truncate">{data.owner.username}</span>
            )}
            {data.owner && viewCount > 0 && (
              <span className="text-white/40">·</span>
            )}
            {viewCount > 0 && (
              <span className="tabular-nums">{formatViews(viewCount)} views</span>
            )}
          </div>
        </div>
      </Link>
    );
  }

  if (layout === "endCardHorizontal") {
    /**
     * YouTube-mobile end card: horizontal layout (thumbnail left, text right).
     * Used by the player's EndCardOverlay on narrow players where a vertical
     * stack of full-width cards reads way better than tiny side-by-side
     * thumbnails. Sizing is driven by the player container (container queries
     *  cqi units) so the card grows with the player.
     */
    const durationSec = typeof data.duration === "number" ? data.duration : 0;
    const durationStr = formatDuration(durationSec);
    return (
      <Link
        to={watchPath}
        onClick={(e) => {
          e.preventDefault();
          void handleWatchNav();
        }}
        className="group flex h-full w-full items-stretch gap-[clamp(0.5rem,2cqi,0.875rem)] rounded-lg p-[clamp(0.25rem,1cqi,0.5rem)] text-left transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        {/* Thumbnail  fixed 38% of card width, locked to 16:9 so card height
            stays predictable for the overlay's vertical stack math. */}
        <div className="relative aspect-video h-full shrink-0 overflow-hidden rounded-md bg-card ring-1 ring-white/10">
          {renderThumbnail("h-full w-full")}
          {durationStr && (
            <span className="absolute right-1 bottom-1 rounded bg-black/85 px-1 py-0.5 text-[clamp(9px,2.4cqi,11px)] font-semibold tabular-nums leading-none text-white">
              {durationStr}
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-[clamp(0.125rem,0.7cqi,0.375rem)]">
          <h3 className="line-clamp-2 text-[clamp(12px,3cqi,16px)] font-semibold leading-snug text-white">
            <ParseFilenameInsert filename={data.file_title || data.filename} showLimit={80} />
          </h3>
          <div className="flex min-w-0 flex-wrap items-center gap-x-1 text-[clamp(10px,2.4cqi,13px)] leading-tight text-white/70">
            {data.owner && (
              <span className="max-w-[12rem] truncate">{data.owner.username}</span>
            )}
            {data.owner && viewCount > 0 && (
              <span className="text-white/40">·</span>
            )}
            {viewCount > 0 && (
              <span className="tabular-nums">{formatViews(viewCount)} views</span>
            )}
          </div>
        </div>
      </Link>
    );
  }

  if (layout === "studioRow") {
    // Studio table cell. Uses the same renderThumbnail + renderEditDialog
    // as every other layout so adult blur, retry, lazy load, and the edit
    // upload dialog (title / description / skip markers / series) stay
    // identical to the rest of the app — no duplication.
    const durationSec = typeof data.duration === "number" ? data.duration : 0;
    const durationStr = formatDuration(durationSec);
    const sameYear =
      data.created_at && new Date(data.created_at).getFullYear() === new Date().getFullYear();
    const postedAt = data.created_at
      ? new Date(data.created_at).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          ...(sameYear ? {} : { year: "numeric" }),
          hour: "numeric",
          minute: "2-digit",
        })
      : "";
    return (
      <>
        <Link
          to={watchPath}
          onClick={(e) => {
            e.preventDefault();
            void handleWatchNav();
          }}
          className="flex min-w-0 items-start gap-3"
        >
          <div className="relative h-[4.25rem] w-[6.75rem] shrink-0 overflow-hidden rounded-md bg-card ring-1 ring-border/30 sm:h-16 sm:w-28">
            {renderThumbnail("h-full w-full")}
            {durationStr && (
              <span className="absolute right-1 bottom-1 rounded bg-black/80 px-1 py-px text-[10px] font-semibold tabular-nums leading-none text-white">
                {durationStr}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <p className="line-clamp-2 text-sm font-semibold text-foreground">
              <ParseFilenameInsert filename={data.file_title || data.filename} showLimit={120} />
            </p>
            {postedAt && (
              <p className="mt-1 text-xs text-muted-foreground">{postedAt}</p>
            )}
          </div>
        </Link>
        {renderEditDialog()}
      </>
    );
  }

  if (layout === "notificationThumb") {
    /**
     * Bare 16:9 poster  no title, no actions, no internal <Link>. Used
     * as the right-side preview in the notifications inbox where the
     * notification row IS already a link wrapping the whole thing.
     *
     * All the actual thumbnail logic (default vs thumbnails[] vs
     * legacy path, NSFW handling, retry-on-error, lazy loading) lives
     * in `renderThumbnail` above  this layout exists purely so the
     * inbox doesn't reinvent it.
     */
    return (
      <div className="relative h-full w-full overflow-hidden rounded-md bg-card ring-1 ring-border/40">
        {renderThumbnail("h-full w-full")}
      </div>
    );
  }

  if (layout === "compact") {
    const durationSec = typeof data.duration === "number" ? data.duration : 0;
    const durationStr = formatDuration(durationSec);
    return (
      <div className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/50">
        <Link
          onClick={(e) => {
            e.preventDefault();
            void handleWatchNav();
          }}
          to={watchPath}
          className="relative aspect-video w-[7rem] shrink-0 overflow-hidden rounded-md bg-card ring-1 ring-border/20 dark:ring-white/10"
        >
          {renderThumbnail("h-full w-full")}
          {durationStr && (
            <span className="absolute right-1 bottom-1 rounded bg-black/80 px-1 py-px text-[9px] font-semibold tabular-nums leading-none text-white">
              {durationStr}
            </span>
          )}
        </Link>

        <div className="flex min-w-0 flex-1 items-start justify-between gap-1.5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <Link
              to={watchPath}
              onClick={(e) => {
                e.preventDefault();
                void handleWatchNav();
              }}
              className="hover:text-primary transition-colors"
            >
              <h3 className="line-clamp-2 text-[13px] font-medium leading-snug">
                <ParseFilenameInsert filename={data.file_title || data.filename} showLimit={50} />
              </h3>
            </Link>

            <div className="flex min-w-0 flex-wrap items-center gap-x-1 text-[11px] text-muted-foreground leading-tight">
              {data.owner && (
                <span className="max-w-[8rem] truncate hover:text-foreground transition-colors">
                  {data.owner.username}
                </span>
              )}
              {data.owner && (viewCount > 0 || data.created_at) && (
                <span className="text-muted-foreground/50">·</span>
              )}
              {viewCount > 0 && (
                <span className="tabular-nums">{formatViews(viewCount)} views</span>
              )}
              {viewCount > 0 && data.created_at && (
                <span className="text-muted-foreground/50">·</span>
              )}
              {data.created_at && <span>{formatTimeAgo(data.created_at)}</span>}
            </div>

            {!hideActions?.halfway && <>{renderActions()}</>}
          </div>

          {hideActions.halfway && (
            <div className="shrink-0">{renderActions()}</div>
          )}
        </div>

        {renderEditDialog()}
        {renderInfoDialog()}
        {seriesEpisodesPreviewDialogEl}
      </div>
    );
  }

  return (
    <div className="item group rounded-2xl relative flex flex-col py-4 h-full">
      <Link
        onClick={(e) => {
          e.preventDefault();
          void handleWatchNav();
        }}
        to={watchPath}
        className="w-full bg-card rounded-2xl overflow-hidden relative aspect-video group-hover:z-[1000000] z-[10]"
      >
        {renderThumbnail("w-full h-full")}
      </Link>

      <div
        className={
          cn(
            'hover_overlay pointer-events-none absolute inset-0 z-[10] rounded-2xl  opacity-0 scale-100 group-hover:z-[100] group-hover:opacity-100 group-hover:scale-105 transition-all duration-300 ease-out',
            `bg-muted/80`
          )
        }
      />

      <div className="py-2 flex flex-col z-[1000000]">
        <div className="pointer-events-auto mb-1 flex items-start gap-3">
          {data.owner && (
            <OwnerProfile
              showUsername={false}
              owner={data.owner}
              size="sm"
              className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
            />
          )}
          <div className={`flex min-h-[2.5rem] min-w-0 flex-1 justify-between relative`}>
            <div className="flex flex-1 flex-col justify-center">
              <div className="flex items-start gap-1.5">
                <Link
                  to={watchPath}
                  onClick={(e) => {
                    e.preventDefault();
                    void handleWatchNav();
                  }}
                  className="min-w-0 flex-1 hover:text-primary transition-colors"
                >
                  <h3 className="line-clamp-2 text-sm font-semibold leading-tight md:text-base">
                    <ParseFilenameInsert filename={data.file_title || data.filename} showLimit={50} characterSplit={true} className={`flex flex-wrap`}/>
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
              <div className="mt-0.5 flex min-h-[1.25rem] flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-muted-foreground">
                {data.owner && (
                  <Link
                    to={`/profile/${data.owner.username}`}
                    className="max-w-[120px] truncate hover:text-foreground transition-colors"
                  >
                    {data.owner.username}
                  </Link>
                )}
                {data.owner && viewCount > 0 && <span className="text-muted-foreground/60">·</span>}
                {viewCount > 0 && <span>{formatViews(viewCount)} views</span>}
              </div>
            </div>
            <div>
              {
                (hideActions.halfway) && (
                  <>
                    {renderActions()}
                  </>
                )
              }
            </div>
          </div>
        </div>

      </div>

      <div className="z-[1000000]">
      {
        (!hideActions?.halfway) && (
          <>{renderActions()}</>
        )
      }
      </div>
      {renderEditDialog()}
      {renderInfoDialog()}
      {seriesEpisodesPreviewDialogEl}
    </div>
  );
};

export const VIDEOCARD_OPEN_EDIT_EVENT = "videocard:open-edit";

export function requestVideoCardEdit(uniqueId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(VIDEOCARD_OPEN_EDIT_EVENT, { detail: { uniqueId } }),
  );
}

export default VideoCard;