import React, { useEffect, useMemo, useRef, useState, useCallback } from "react"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog"
import { Button } from "~/components/ui/button"
import { Progress } from "~/components/ui/progress"
import { Input } from "~/components/ui/input"
import { Textarea } from "~/components/ui/textarea"
import {
  Upload,
  X,
  FileImage,
  FileVideo,
  Trash2,
  ChevronDown,
  Tag,
  CloudUpload,
  Check,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  ImagePlus,
  MessageSquare,
  MessageSquareOff,
  Layers,
  Play,
  GripVertical,
  Plus,
} from "lucide-react"
import { GenerateUniqueID } from "~/lib/GenerateUniqueID"
import { useFileContext } from "~/lib/Context/Context"
import { Link, useNavigate } from "react-router"
import { MAX_UPLOAD_FILE_BYTES } from "~/lib/uploadLimits"
import { SignInDialog } from "~/components/SignInWall"
import { cn } from "~/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip"

function extractVideoPosterUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const blobUrl = URL.createObjectURL(file)
    const video = document.createElement("video")
    video.muted = true
    video.playsInline = true
    video.preload = "auto"
    let settled = false
    const finish = (posterUrl: string | null) => {
      if (settled) return
      settled = true
      URL.revokeObjectURL(blobUrl)
      video.removeAttribute("src")
      video.load()
      video.remove()
      resolve(posterUrl)
    }
    const captureFrame = () => {
      try {
        const w = video.videoWidth
        const h = video.videoHeight
        if (!w || !h) {
          finish(null)
          return
        }
        const canvas = document.createElement("canvas")
        const maxW = 1280
        const scale = w > maxW ? maxW / w : 1
        canvas.width = Math.round(w * scale)
        canvas.height = Math.round(h * scale)
        const ctx = canvas.getContext("2d")
        if (!ctx) {
          finish(null)
          return
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              finish(null)
              return
            }
            finish(URL.createObjectURL(blob))
          },
          "image/jpeg",
          0.82
        )
      } catch {
        finish(null)
      }
    }
    video.addEventListener(
      "loadedmetadata",
      () => {
        try {
          const d = video.duration
          let t = 0.1
          if (Number.isFinite(d) && d > 0) {
            t = Math.min(Math.max(0.05, d * 0.05), Math.max(0.05, d - 0.01))
          }
          video.currentTime = t
        } catch {
          finish(null)
        }
      },
      { once: true }
    )
    video.addEventListener("seeked", captureFrame, { once: true })
    video.addEventListener("error", () => finish(null), { once: true })
    video.src = blobUrl
    video.load()
  })
}

const CATEGORY_OPTIONS = [
  "Gaming",
  "Music",
  "Entertainment",
  "Education",
  "Technology",
  "Sports",
  "News",
  "Lifestyle",
  "Anime",
  "Film",
  "Automotive",
  "Art",
  "Nature",
  "Other",
]

interface SeriesLane {
  id: string
  seriesMode: "create" | "existing"
  seriesEpisodeName: string
  seriesSelected: { file_series_id: string; file_title: string } | null
  seriesEpisodeSubmode: "existing" | "new" | null
  seriesEpisodeId: string | null
  seriesParentEpisodeId: string | null
  seriesEpisodesList: { id: string; episode_name: string; parent_episode_id: string | null }[]
}

function emptySeriesLane(): SeriesLane {
  return {
    id: `lane-${GenerateUniqueID()}`,
    seriesMode: "create",
    seriesEpisodeName: "",
    seriesSelected: null,
    seriesEpisodeSubmode: null,
    seriesEpisodeId: null,
    seriesParentEpisodeId: null,
    seriesEpisodesList: [],
  }
}

interface MediaSelectionModalProps {
  isOpen: boolean
  onClose: () => void
  onFilesSelected: (files: File[]) => void
  maxFileSizeBytes?: number
  initialFiles?: File[]
  onFilesConsumed?: () => void
}

type UploadStatus = "idle" | "uploading" | "processing" | "success" | "error"

interface MediaItem {
  id: string
  file: File
  previewUrl: string
  videoPosterUrl: string | null
  isExtractingVideoPoster: boolean
  title: string
  description: string
  isPublic: boolean
  categories: string[]
  tags: string[]
  commentsEnabled: boolean
  commentLimit: number | null
  customThumbnail: File | null
  customThumbnailPreview: string | null
  status: UploadStatus
  progress: number
  statusText: string | null
  error: string | null
  jobId: string | null
  isLocked: boolean
  seriesMode: "none" | "create" | "existing"
  seriesEpisodeName: string
  seriesSelected: { file_series_id: string; file_title: string } | null
  seriesEpisodeSubmode: "existing" | "new" | null
  seriesEpisodeId: string | null
  seriesParentEpisodeId: string | null
  seriesEpisodesList: { id: string; episode_name: string; parent_episode_id: string | null }[]
  assignedSeriesLaneId: string | null
}

function applyLaneToVideoItem(item: MediaItem, lane: SeriesLane): MediaItem {
  return {
    ...item,
    seriesMode: lane.seriesMode,
    seriesEpisodeName: lane.seriesEpisodeName,
    seriesSelected: lane.seriesSelected,
    seriesEpisodeSubmode: lane.seriesEpisodeSubmode,
    seriesEpisodeId: lane.seriesEpisodeId,
    seriesParentEpisodeId: lane.seriesParentEpisodeId,
    seriesEpisodesList: lane.seriesEpisodesList,
  }
}

function clearSeriesFields(): Pick<
  MediaItem,
  | "seriesMode"
  | "seriesEpisodeName"
  | "seriesSelected"
  | "seriesEpisodeSubmode"
  | "seriesEpisodeId"
  | "seriesParentEpisodeId"
  | "seriesEpisodesList"
> {
  return {
    seriesMode: "none",
    seriesEpisodeName: "",
    seriesSelected: null,
    seriesEpisodeSubmode: null,
    seriesEpisodeId: null,
    seriesParentEpisodeId: null,
    seriesEpisodesList: [],
  }
}

function renumberCreateLaneEpisodes(items: MediaItem[], lanes: SeriesLane[]): MediaItem[] {
  const autoLaneIds = new Set(
    lanes
      .filter(
        (l) =>
          l.seriesMode === "create" ||
          (l.seriesMode === "existing" && l.seriesEpisodeSubmode === "new")
      )
      .map((l) => l.id)
  )
  const counters: Record<string, number> = {}
  return items.map((it) => {
    if (!it.file.type.startsWith("video/") || !it.assignedSeriesLaneId) return it
    if (!autoLaneIds.has(it.assignedSeriesLaneId)) return it
    const n = (counters[it.assignedSeriesLaneId] = (counters[it.assignedSeriesLaneId] ?? 0) + 1)
    return { ...it, seriesEpisodeName: `Episode ${n}` }
  })
}

function laneTitle(lane: SeriesLane): string {
  if (lane.seriesMode === "create") return "New series"
  return lane.seriesSelected?.file_title?.trim() || "Existing series"
}

type SortableFileRowProps = {
  item: MediaItem
  isActive: boolean
  laneBadge?: string | null
  isUploadingBatch: boolean
  onSelect: () => void
  onRemove: () => void
  statusIcon: (status: UploadStatus) => React.ReactNode
  formatBytes: (bytes: number) => string
}

function SortableFileRow({
  item,
  isActive,
  laneBadge,
  isUploadingBatch,
  onSelect,
  onRemove,
  statusIcon,
  formatBytes,
}: SortableFileRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  })
  const isVideo = item.file.type.startsWith("video/")
  const videoStill = isVideo ? item.customThumbnailPreview ?? item.videoPosterUrl : null

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "w-full rounded-2xl p-2 sm:p-1.5 min-h-[52px] sm:min-h-0 transition-all duration-200 flex items-stretch gap-1 sm:gap-1.5 group/item",
        "bg-card/80 backdrop-blur-sm border border-border/60",
        isActive && "ring-1 ring-primary/40 border-primary/30 bg-accent shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
        !isActive && "hover:bg-accent/60 hover:border-border",
        isDragging && "z-20 scale-[1.02] shadow-lg ring-1 ring-primary/30 bg-card"
      )}
    >
      <button
        type="button"
        className="shrink-0 w-9 sm:w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted cursor-grab active:cursor-grabbing touch-none"
        aria-label="Drag to reorder or drop onto a series"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={onSelect}
        className="flex-1 min-w-0 text-left flex items-center gap-2.5 py-0.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        <div className="relative w-11 h-11 sm:w-10 sm:h-10 rounded-xl overflow-hidden bg-muted shrink-0 ring-1 ring-border/70">
          {isVideo ? (
            item.isExtractingVideoPoster && !videoStill ? (
              <div className="w-full h-full flex items-center justify-center">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : videoStill ? (
              <img src={videoStill} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <FileVideo className="w-5 h-5 text-muted-foreground" />
              </div>
            )
          ) : (
            <img src={item.previewUrl} alt="" className="w-full h-full object-cover" />
          )}
          {item.status !== "idle" && (
            <div
              className={`absolute inset-0 flex items-center justify-center ${
                item.status === "success"
                  ? "bg-green-500/20"
                  : item.status === "error"
                    ? "bg-destructive/20"
                    : "bg-foreground/25"
              }`}
            >
              {statusIcon(item.status)}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block min-w-0 truncate text-[13px] font-medium text-foreground leading-tight cursor-default text-left">
                {item.file.name}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6} className="max-w-[min(90vw,22rem)] break-words">
              {item.file.name}
            </TooltipContent>
          </Tooltip>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5">
            <p className="text-[11px] text-muted-foreground tabular-nums">
              {formatBytes(item.file.size)}
              {item.status === "uploading" && ` · ${item.progress}%`}
            </p>
            {laneBadge && isVideo && (
              <span className="text-[10px] font-medium text-primary/90 bg-primary/10 px-1.5 py-px rounded-md truncate max-w-[120px]">
                {laneBadge}
              </span>
            )}
          </div>
          {item.status === "uploading" && <Progress value={item.progress} className="h-0.5 mt-1" />}
          {item.error && <p className="text-[10px] text-destructive truncate mt-0.5">{item.error}</p>}
        </div>
      </button>
      {!isUploadingBatch && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="shrink-0 w-9 h-9 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center opacity-100 md:opacity-0 md:group-hover/item:opacity-100 focus-visible:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-opacity touch-manipulation self-center"
          aria-label={`Remove ${item.file.name}`}
        >
          <X className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
        </button>
      )}
    </div>
  )
}

function LaneCard({
  disabled,
  children,
  className,
}: {
  disabled: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/70 bg-card text-card-foreground shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-opacity",
        disabled && "opacity-40 pointer-events-none",
        className
      )}
    >
      {children}
    </div>
  )
}

export const MediaSelectionModal: React.FC<MediaSelectionModalProps> = ({
  isOpen,
  onClose,
  onFilesSelected,
  maxFileSizeBytes,
  initialFiles,
  onFilesConsumed,
}) => {
  const { userId, c_user, uploadServerUrl, userProfile } = useFileContext()
  const navigate = useNavigate()
  const [items, setItems] = useState<MediaItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploadResultBanner, setUploadResultBanner] = useState<{ ok: number; fail: number } | null>(null)
  const [isUploadingBatch, setIsUploadingBatch] = useState(false)
  const [tagInput, setTagInput] = useState("")
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [seriesBrowseOpen, setSeriesBrowseOpen] = useState(false)
  const [seriesSearch, setSeriesSearch] = useState("")
  const [seriesBrowseResults, setSeriesBrowseResults] = useState<{ file_title: string; file_series_id: string }[]>([])
  const [seriesBrowseLoading, setSeriesBrowseLoading] = useState(false)
  const [signInOpen, setSignInOpen] = useState(false)
  const [videoPlaybackUrl, setVideoPlaybackUrl] = useState<string | null>(null)
  const categoryRef = useRef<HTMLDivElement>(null)
  const itemsRef = useRef<MediaItem[]>([])
  const dropRef = useRef<HTMLDivElement>(null)
  const thumbInputRef = useRef<HTMLInputElement>(null)
  const [seriesLanes, setSeriesLanes] = useState<SeriesLane[]>([])
  const [seriesOrganizerOpen, setSeriesOrganizerOpen] = useState(false)
  const [seriesBrowseForLaneId, setSeriesBrowseForLaneId] = useState<string | null>(null)
  const [filePickerLaneId, setFilePickerLaneId] = useState<string | null>(null)
  const seriesLanesRef = useRef(seriesLanes)
  useEffect(() => {
    seriesLanesRef.current = seriesLanes
  }, [seriesLanes])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  useEffect(() => {
    if (isOpen && !userId) {
      onClose()
      setSignInOpen(true)
    }
  }, [isOpen, userId, onClose])

  useEffect(() => {
    if (!isOpen && items.length > 0) {
      resetState()
    }
  }, [isOpen, items])

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  useEffect(() => {
    if (!isOpen || !initialFiles || initialFiles.length === 0) {
      return
    }
    addFiles(initialFiles)
    onFilesConsumed?.()
  }, [isOpen, initialFiles, onFilesConsumed])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (categoryRef.current && !categoryRef.current.contains(e.target as Node)) {
        setShowCategoryDropdown(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const effectiveMaxSize = maxFileSizeBytes ?? MAX_UPLOAD_FILE_BYTES

  const resetState = () => {
    setVideoPlaybackUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    items.forEach((item) => {
      if (item.file.type.startsWith("image/")) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      } else if (item.videoPosterUrl) {
        URL.revokeObjectURL(item.videoPosterUrl)
      }
      if (item.customThumbnailPreview) URL.revokeObjectURL(item.customThumbnailPreview)
    })
    setItems([])
    setActiveId(null)
    setError(null)
    setIsUploadingBatch(false)
    setTagInput("")
    setShowCategoryDropdown(false)
    setIsDragging(false)
    setSeriesLanes([])
    setSeriesOrganizerOpen(false)
    setSeriesBrowseForLaneId(null)
    setUploadResultBanner(null)
  }

  const formatBytes = (bytes: number) => {
    if (!bytes) return "0 B"
    const k = 1024
    const sizes = ["B", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    const value = bytes / Math.pow(k, i)
    return `${value.toFixed(i > 1 ? 1 : 0)} ${sizes[i]}`
  }

  const validateFile = (file: File): string | null => {
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      return "Only image and video files are allowed."
    }
    if (file.size > effectiveMaxSize) {
      return `File is too large. Maximum size is ${formatBytes(effectiveMaxSize)}.`
    }
    return null
  }

  const createMediaItem = (file: File): MediaItem => {
    const baseName = file.name.replace(/\.[^./\\]+$/, "")
    const isVideo = file.type.startsWith("video/")
    return {
      id: `${file.name}-${file.size}-${file.lastModified}-${GenerateUniqueID()}`,
      file,
      previewUrl: isVideo ? "" : URL.createObjectURL(file),
      videoPosterUrl: null,
      isExtractingVideoPoster: isVideo,
      title: baseName.slice(0, 200),
      description: "",
      isPublic: true,
      categories: [],
      tags: [],
      commentsEnabled: true,
      commentLimit: null,
      customThumbnail: null,
      customThumbnailPreview: null,
      status: "idle",
      progress: 0,
      statusText: null,
      error: null,
      jobId: null,
      isLocked: false,
      seriesMode: "none",
      seriesEpisodeName: "",
      seriesSelected: null,
      seriesEpisodeSubmode: null,
      seriesEpisodeId: null,
      seriesParentEpisodeId: null,
      seriesEpisodesList: [],
      assignedSeriesLaneId: null,
    }
  }

  const addFiles = (files: File[]) => {
    if (files.length === 0 || isUploadingBatch) return
    const nextItems: MediaItem[] = []
    const errors: string[] = []

    files.forEach((file) => {
      const validationError = validateFile(file)
      if (validationError) {
        errors.push(`${file.name}: ${validationError}`)
        return
      }
      nextItems.push(createMediaItem(file))
    })

    if (errors.length > 0) {
      setError(errors.slice(0, 3).join(" | "))
    } else {
      setError(null)
    }

    if (nextItems.length === 0) return

    setItems((prev) => {
      const updated = [...prev, ...nextItems]
      if (!activeId) {
        setActiveId(nextItems[0]?.id || null)
      }
      return updated
    })

    nextItems.forEach((item) => {
      if (!item.file.type.startsWith("video/")) return
      const itemId = item.id
      void extractVideoPosterUrl(item.file).then((posterUrl) => {
        setItems((prev) => {
          const cur = prev.find((i) => i.id === itemId)
          if (!cur || !cur.file.type.startsWith("video/")) return prev
          if (posterUrl) {
            const old = cur.videoPosterUrl
            if (old) URL.revokeObjectURL(old)
            return prev.map((i) =>
              i.id === itemId ? { ...i, videoPosterUrl: posterUrl, isExtractingVideoPoster: false } : i
            )
          }
          return prev.map((i) => (i.id === itemId ? { ...i, isExtractingVideoPoster: false } : i))
        })
      })
    })
  }

  const handleFileChange = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || isUploadingBatch) return
    addFiles(Array.from(fileList))
  }

  const openFilePicker = useCallback(() => {
    if (isUploadingBatch) return
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "image/*,video/*"
    input.multiple = true
    input.onchange = (e) => {
      const target = e.target as HTMLInputElement
      handleFileChange(target.files)
      if (document.body.contains(input)) {
        document.body.removeChild(input)
      }
    }
    document.body.appendChild(input)
    input.click()
  }, [isUploadingBatch])

  const updateItem = (id: string, updater: (item: MediaItem) => MediaItem) => {
    setItems((prev) => prev.map((item) => (item.id === id ? updater(item) : item)))
  }

  const loadEpisodesForLane = (laneId: string, fileSeriesId: string) => {
    void (async () => {
      try {
        const res = await fetch(
          `/api/series-episodes?file_series_id=${encodeURIComponent(fileSeriesId)}`,
          { credentials: "include" }
        )
        const j = await res.json().catch(() => ({}))
        if (!res.ok) return
        const raw = Array.isArray(j.episodes)
          ? (j.episodes as {
              id: string
              episode_name: string
              parent_episode_id?: string | null
            }[])
          : []
        const list = raw.map((e) => ({
          id: e.id,
          episode_name: e.episode_name,
          parent_episode_id:
            e.parent_episode_id != null && String(e.parent_episode_id).trim() !== ""
              ? String(e.parent_episode_id)
              : null,
        }))
        setSeriesLanes((prev) => {
          const next = prev.map((l) =>
            l.id === laneId
              ? {
                  ...l,
                  seriesEpisodesList: list,
                  seriesEpisodeSubmode: (list.length > 0 ? "existing" : "new") as "existing" | "new",
                  seriesEpisodeId: null,
                  seriesEpisodeName: "",
                  seriesParentEpisodeId: null,
                }
              : l
          )
          const lane = next.find((x) => x.id === laneId)
          if (lane) {
            setItems((items) => {
              const mapped = items.map((it) =>
                it.assignedSeriesLaneId === laneId && it.file.type.startsWith("video/")
                  ? applyLaneToVideoItem(it, lane)
                  : it
              )
              return renumberCreateLaneEpisodes(mapped, next)
            })
          }
          return next
        })
      } catch {
      }
    })()
  }

  const patchLaneAndSync = (laneId: string, patch: Partial<SeriesLane>) => {
    setSeriesLanes((prev) => {
      const next = prev.map((l) => (l.id === laneId ? { ...l, ...patch } : l))
      const lane = next.find((l) => l.id === laneId)
      if (lane) {
        setItems((items) => {
          const mapped = items.map((it) =>
            it.assignedSeriesLaneId === laneId && it.file.type.startsWith("video/")
              ? applyLaneToVideoItem(it, lane)
              : it
          )
          return renumberCreateLaneEpisodes(mapped, next)
        })
      }
      return next
    })
  }

  const addSeriesLane = () => {
    setSeriesLanes((prev) => [...prev, emptySeriesLane()])
  }

  const removeSeriesLane = (laneId: string) => {
    setSeriesLanes((prev) => prev.filter((l) => l.id !== laneId))
    setItems((prev) =>
      prev.map((it) =>
        it.assignedSeriesLaneId === laneId
          ? { ...it, assignedSeriesLaneId: null, ...clearSeriesFields() }
          : it
      )
    )
  }

  const removeFileFromSeriesOrganizer = (itemId: string) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === itemId ? { ...it, assignedSeriesLaneId: null, ...clearSeriesFields() } : it
      )
    )
  }

  const updateItemSeries = (id: string, updater: (item: MediaItem) => MediaItem) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item
        const next = updater(item)
        return { ...next, assignedSeriesLaneId: null }
      })
    )
  }

  const loadEpisodesForItem = (itemId: string, fileSeriesId: string) => {
    void (async () => {
      try {
        const res = await fetch(
          `/api/series-episodes?file_series_id=${encodeURIComponent(fileSeriesId)}`,
          { credentials: "include" }
        )
        const j = await res.json().catch(() => ({}))
        if (!res.ok) return
        const raw = Array.isArray(j.episodes)
          ? (j.episodes as { id: string; episode_name: string; parent_episode_id?: string | null }[])
          : []
        const list = raw.map((e) => ({
          id: e.id,
          episode_name: e.episode_name,
          parent_episode_id:
            e.parent_episode_id != null && String(e.parent_episode_id).trim() !== ""
              ? String(e.parent_episode_id)
              : null,
        }))
        updateItemSeries(itemId, (c) => ({
          ...c,
          seriesEpisodesList: list,
          seriesEpisodeSubmode: list.length > 0 ? "existing" : "new",
          seriesEpisodeId: null,
          seriesEpisodeName: "",
          seriesParentEpisodeId: null,
        }))
      } catch {}
    })()
  }

  const openSeriesBrowse = () => {
    setSeriesSearch("")
    setSeriesBrowseForLaneId(null)
    setSeriesBrowseOpen(true)
  }

  const assignFileToLane = (itemId: string, laneId: string) => {
    const lane = seriesLanesRef.current.find((l) => l.id === laneId)
    if (!lane) return
    setItems((prev) => {
      const next = prev.map((it) => {
        if (it.id !== itemId) return it
        if (!it.file.type.startsWith("video/")) return it
        return {
          ...applyLaneToVideoItem({ ...it, assignedSeriesLaneId: laneId }, lane),
          assignedSeriesLaneId: laneId,
        }
      })
      return renumberCreateLaneEpisodes(next, seriesLanesRef.current)
    })
  }

  const removeItem = (id: string) => {
    if (isUploadingBatch) return
    setItems((prev) => {
      const target = prev.find((item) => item.id === id)
      if (target) {
        if (target.file.type.startsWith("image/")) {
          if (target.previewUrl) URL.revokeObjectURL(target.previewUrl)
        } else if (target.videoPosterUrl) {
          URL.revokeObjectURL(target.videoPosterUrl)
        }
        if (target.customThumbnailPreview) URL.revokeObjectURL(target.customThumbnailPreview)
      }
      const next = prev.filter((item) => item.id !== id)
      if (activeId === id) setActiveId(next[0]?.id || null)
      return next
    })
  }

  const toggleCategory = (cat: string) => {
    if (!activeItem) return
    updateItem(activeItem.id, (current) => {
      const has = current.categories.includes(cat)
      return {
        ...current,
        categories: has ? current.categories.filter((c) => c !== cat) : [...current.categories, cat],
      }
    })
  }

  const addTag = (value: string) => {
    if (!activeItem) return
    const tag = value.trim().toLowerCase()
    if (!tag || tag.length > 50) return
    if (activeItem.tags.includes(tag)) return
    if (activeItem.tags.length >= 15) return
    updateItem(activeItem.id, (current) => ({
      ...current,
      tags: [...current.tags, tag],
    }))
  }

  const removeTag = (tag: string) => {
    if (!activeItem) return
    updateItem(activeItem.id, (current) => ({
      ...current,
      tags: current.tags.filter((t) => t !== tag),
    }))
  }

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      addTag(tagInput)
      setTagInput("")
    }
    if (e.key === "Backspace" && tagInput === "" && activeItem && activeItem.tags.length > 0) {
      removeTag(activeItem.tags[activeItem.tags.length - 1])
    }
  }

  const handleThumbnailSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (thumbInputRef.current) thumbInputRef.current.value = ""
    if (!file || !activeItem) return
    if (!file.type.startsWith("image/")) return
    if (file.size > 10 * 1024 * 1024) return
    if (activeItem.customThumbnailPreview) URL.revokeObjectURL(activeItem.customThumbnailPreview)
    const preview = URL.createObjectURL(file)
    updateItem(activeItem.id, (c) => ({ ...c, customThumbnail: file, customThumbnailPreview: preview }))
  }

  const removeThumbnail = () => {
    if (!activeItem) return
    if (activeItem.customThumbnailPreview) URL.revokeObjectURL(activeItem.customThumbnailPreview)
    updateItem(activeItem.id, (c) => ({ ...c, customThumbnail: null, customThumbnailPreview: null }))
  }

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        const comma = result.indexOf(",")
        const raw = comma >= 0 ? result.slice(comma + 1) : result
        resolve(raw.replace(/\s/g, ""))
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragIn = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true)
    }
  }, [])

  const handleDragOut = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      addFiles(Array.from(e.dataTransfer.files))
    }
  }, [isUploadingBatch])

  const GO_CHUNK_SIZE = 25 * 1024 * 1024

  const authHeaders = (): Record<string, string> =>
    c_user ? { Authorization: `Bearer ${c_user}` } : {}

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  const fetchWith503Retry = async (
    url: string,
    init: RequestInit,
    onProgress?: (p: number, text: string) => void,
    maxRetries = 3
  ): Promise<Response> => {
    for (let r = 0; r <= maxRetries; r++) {
      const res = await fetch(url, init)
      if (res.status !== 503) return res
      onProgress?.(5, "Server busy. Retrying...")
      let wait = 5
      try {
        const j = await res.json().catch(() => ({}))
        const ra = (j as { retry_after?: number }).retry_after
        if (typeof ra === "number" && ra > 0 && ra <= 120) wait = ra
      } catch {}
      await sleep(wait * 1000)
    }
    return fetch(url, init)
  }

  const uploadToGo = async (item: MediaItem): Promise<{ jobId: string }> => {
    const base = uploadServerUrl.replace(/\/$/, "")
    const totalChunks = Math.ceil(item.file.size / GO_CHUNK_SIZE)

    let startRes = await fetchWith503Retry(
      `${base}/api/upload/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          file_name: item.file.name,
          file_size: item.file.size,
          total_chunks: totalChunks,
        }),
      },
      (p, t) => updateItem(item.id, (c) => ({ ...c, progress: p, statusText: t }))
    )
    if (startRes.status === 401) throw new Error("Session expired. Please log in again.")
    if (!startRes.ok) {
      const j = await startRes.json().catch(() => ({}))
      throw new Error((j as { error?: string }).error || "Upload start failed")
    }
    const startJson = (await startRes.json()) as { upload_id: string }
    const uploadId = startJson.upload_id
    if (!uploadId) throw new Error("Upload start failed")

    for (let i = 0; i < totalChunks; i++) {
      const start = i * GO_CHUNK_SIZE
      const end = Math.min(start + GO_CHUNK_SIZE, item.file.size)
      const blob = item.file.slice(start, end)

      let chunkRes = await fetchWith503Retry(
        `${base}/api/upload/chunk`,
        {
          method: "POST",
          headers: {
            "X-Upload-ID": uploadId,
            "X-Chunk-Index": String(i),
            ...authHeaders(),
          },
          body: blob,
        },
        (p, t) =>
          updateItem(item.id, (c) => ({
            ...c,
            progress: 5 + Math.round(((i + 0.5) / totalChunks) * 90),
            statusText: t || `Uploading chunk ${i + 1}/${totalChunks}...`,
          }))
      )
      if (chunkRes.status === 401) throw new Error("Session expired. Please log in again.")
      if (chunkRes.status === 404) throw new Error("Upload session expired. Please try again.")
      if (!chunkRes.ok) {
        const j = await chunkRes.json().catch(() => ({}))
        throw new Error((j as { error?: string }).error || "Chunk upload failed")
      }
      updateItem(item.id, (c) => ({
        ...c,
        progress: 5 + Math.round(((i + 1) / totalChunks) * 90),
        statusText: `Uploading chunk ${i + 1}/${totalChunks}...`,
      }))
    }

    let defaultThumbnailB64 = ""
    if (item.customThumbnail) {
      try {
        defaultThumbnailB64 = await fileToBase64(item.customThumbnail)
      } catch {}
    }

    const seriesPayload: Record<string, unknown> = {}
    if (item.file.type.startsWith("video/")) {
      if (item.seriesMode === "create") {
        seriesPayload.is_new_series = true
        seriesPayload.new_episode_name = item.seriesEpisodeName.trim()
      } else if (item.seriesMode === "existing" && item.seriesSelected?.file_series_id) {
        seriesPayload.file_series_id = item.seriesSelected.file_series_id
        if (item.seriesEpisodeSubmode === "existing" && item.seriesEpisodeId) {
          seriesPayload.file_series_episode_id = item.seriesEpisodeId
        } else if (item.seriesEpisodeSubmode === "new") {
          seriesPayload.new_episode_name = item.seriesEpisodeName.trim()
          if (item.seriesParentEpisodeId) {
            seriesPayload.parent_episode_id = item.seriesParentEpisodeId
          }
        }
      }
    }

    let completeRes = await fetchWith503Retry(
      `${base}/api/upload/${uploadId}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          is_public: item.isPublic,
          title: item.title.trim(),
          description: item.description.trim(),
          categories: item.categories,
          tags: item.tags,
          comments_enabled: item.commentsEnabled,
          comment_limit:
            item.commentsEnabled && item.commentLimit != null && item.commentLimit >= 1
              ? item.commentLimit
              : null,
          ...(defaultThumbnailB64 ? { default_thumbnail: defaultThumbnailB64 } : {}),
          ...seriesPayload,
        }),
      },
      (p, t) => updateItem(item.id, (c) => ({ ...c, progress: 95, statusText: t }))
    )
    if (completeRes.status === 401) throw new Error("Session expired. Please log in again.")
    if (!completeRes.ok) {
      const j = await completeRes.json().catch(() => ({}))
      throw new Error((j as { error?: string }).error || "Complete upload failed")
    }
    const completeJson = (await completeRes.json()) as { job_id?: string; jobId?: string }
    const jobId = completeJson.job_id ?? completeJson.jobId
    if (!jobId) throw new Error("Complete upload failed")
    return { jobId }
  }

  const uploadFile = (item: MediaItem): Promise<any> => {
    updateItem(item.id, (current) => ({
      ...current,
      status: "uploading",
      progress: 5,
      statusText: "Preparing upload...",
      error: null,
      jobId: null,
    }))

    if (uploadServerUrl && c_user) {
      return uploadToGo(item)
    }

    return new Promise<any>((resolve, reject) => {
      const uniqueID = GenerateUniqueID()
      const formData = new FormData()
      formData.append("file", item.file)
      formData.append("name", item.file.name)
      formData.append("uniqueID", uniqueID)
      if (item.title.trim().length > 0) formData.append("title", item.title.trim())
      if (item.description.trim().length > 0) formData.append("description", item.description.trim())
      formData.append("isPublic", String(item.isPublic))
      formData.append("commentsEnabled", String(item.commentsEnabled))
      if (item.customThumbnail) formData.append("customThumbnail", item.customThumbnail)
      if (item.categories.length > 0) formData.append("categories", JSON.stringify(item.categories))
      if (item.tags.length > 0) formData.append("tags", JSON.stringify(item.tags))

      const xhr = new XMLHttpRequest()
      xhr.open("POST", "/api/upload", true)

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return
        const percent = Math.min(95, Math.max(10, Math.round((event.loaded / event.total) * 100)))
        updateItem(item.id, (current) => ({
          ...current,
          progress: percent,
          statusText: "Uploading...",
        }))
      }

      xhr.onreadystatechange = () => {
        if (xhr.readyState !== XMLHttpRequest.DONE) return
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const text = xhr.responseText || ""
            const parsed = text ? JSON.parse(text) : null
            resolve(parsed)
          } catch {
            resolve(null)
          }
        } else {
          reject(new Error("Upload failed"))
        }
      }

      xhr.onerror = () => reject(new Error("Upload failed"))
      xhr.send(formData)
    })
  }

  const handleUpload = async () => {
    if (items.length === 0) {
      setError("Select files to upload.")
      return
    }
    setError(null)
    setIsUploadingBatch(true)
    setItems((prev) => prev.map((item) => ({ ...item, isLocked: true })))

    const snapshot = [...itemsRef.current]
    let successfulUploads = 0

    for (const item of snapshot) {
      const validationError = validateFile(item.file)
      if (validationError) {
        updateItem(item.id, (current) => ({
          ...current,
          status: "error",
          statusText: "Validation failed.",
          error: validationError,
        }))
        continue
      }

      try {
        await uploadFile(item)
        updateItem(item.id, (current) => ({
          ...current,
          status: "success",
          statusText: "Upload complete. Processing in background.",
          progress: 100,
        }))
        successfulUploads += 1
        onFilesSelected([item.file])
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to upload file. Try again."
        updateItem(item.id, (current) => ({
          ...current,
          status: "error",
          statusText: "Upload failed.",
          error: msg,
        }))
      }
    }

    setIsUploadingBatch(false)
    const failed = snapshot.length - successfulUploads
    if (successfulUploads > 0) {
      setUploadResultBanner({ ok: successfulUploads, fail: failed })
    }
  }

  const clearFailedForRetry = () => {
    setUploadResultBanner(null)
    setItems((prev) =>
      prev.map((i) =>
        i.status === "error"
          ? {
              ...i,
              status: "idle" as const,
              error: null,
              statusText: null,
              isLocked: false,
              progress: 0,
            }
          : i
      )
    )
  }

  const handleClose = () => {
    if (isUploadingBatch) return
    setError(null)
    setUploadResultBanner(null)
    resetState()
    onClose()
  }

  const activeItem = useMemo(() => items.find((item) => item.id === activeId) || items[0], [items, activeId])

  const videoCount = useMemo(
    () => items.filter((i) => i.file.type.startsWith("video/")).length,
    [items]
  )

  useEffect(() => {
    setVideoPlaybackUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
  }, [activeId])

  const startVideoPlayback = () => {
    if (!activeItem?.file.type.startsWith("video/")) return
    setVideoPlaybackUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(activeItem.file)
    })
  }

  const stopVideoPlayback = () => {
    setVideoPlaybackUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
  }

  const activeVideoStill = useMemo(() => {
    if (!activeItem?.file.type.startsWith("video/")) return null
    return activeItem.customThumbnailPreview ?? activeItem.videoPosterUrl
  }, [activeItem?.id, activeItem?.file.type, activeItem?.customThumbnailPreview, activeItem?.videoPosterUrl])

  const activeVideoPosterBusy = useMemo(
    () =>
      !!activeItem?.file.type.startsWith("video/") &&
      activeItem.isExtractingVideoPoster &&
      !activeVideoStill,
    [activeItem?.id, activeItem?.file.type, activeItem?.isExtractingVideoPoster, activeVideoStill]
  )

  const allSeriesFieldsReady = useMemo(() => {
    return items.every((item) => {
      if (!item.file.type.startsWith("video/")) return true
      if (item.seriesMode === "none") return true
      if (item.seriesMode === "create") return item.seriesEpisodeName.trim().length > 0
      if (!item.seriesSelected?.file_series_id) return false
      if (item.seriesEpisodeSubmode === "existing") return !!item.seriesEpisodeId
      if (item.seriesEpisodeSubmode === "new") return item.seriesEpisodeName.trim().length > 0
      return false
    })
  }, [items])

  useEffect(() => {
    if (!seriesBrowseOpen) return
    setSeriesBrowseLoading(true)
    const t = setTimeout(() => {
      void (async () => {
        try {
          const q = encodeURIComponent(seriesSearch.trim())
          const res = await fetch(`/api/my-series?q=${q}`, { credentials: "include" })
          const j = await res.json().catch(() => ({}))
          if (res.ok && Array.isArray(j.series)) {
            setSeriesBrowseResults(j.series)
          } else {
            setSeriesBrowseResults([])
          }
        } catch {
          setSeriesBrowseResults([])
        } finally {
          setSeriesBrowseLoading(false)
        }
      })()
    }, 280)
    return () => clearTimeout(t)
  }, [seriesSearch, seriesBrowseOpen])

  const openSeriesBrowseForLane = (laneId: string) => {
    setSeriesSearch("")
    setSeriesBrowseForLaneId(laneId)
    setSeriesBrowseOpen(true)
  }

  const handleMediaDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    const activeItemId = String(active.id)
    const overId = String(over.id)
    if (activeItemId === overId) return

    if (items.some((i) => i.id === overId)) {
      setItems((prev) => {
        const oldIndex = prev.findIndex((i) => i.id === activeItemId)
        const newIndex = prev.findIndex((i) => i.id === overId)
        if (oldIndex < 0 || newIndex < 0) return prev
        const moved = arrayMove(prev, oldIndex, newIndex)
        return renumberCreateLaneEpisodes(moved, seriesLanesRef.current)
      })
    }
  }

  const isFieldDisabled = !activeItem || isUploadingBatch || !!activeItem?.isLocked

  const statusIcon = (status: UploadStatus) => {
    switch (status) {
      case "uploading": return <Loader2 className="w-3 h-3 animate-spin text-primary" />
      case "success": return <Check className="w-3 h-3 text-green-500" />
      case "error": return <AlertCircle className="w-3 h-3 text-destructive" />
      default: return null
    }
  }

  if (items.length === 0) {
    return (
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent
          className="w-[min(100%,calc(100vw-1.5rem))] max-w-lg rounded-3xl p-0 overflow-hidden max-h-[min(92dvh,640px)] flex flex-col shadow-2xl border-border/60"
          showCloseButton={true}
        >
          <div
            ref={dropRef}
            onDragEnter={handleDragIn}
            onDragLeave={handleDragOut}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={openFilePicker}
            className={`cursor-pointer group flex flex-col items-center justify-center px-6 py-12 sm:p-16 transition-all duration-300 min-h-[min(52vh,320px)] sm:min-h-0 ${
              isDragging
                ? "bg-primary/[0.04] ring-2 ring-primary/30 ring-inset"
                : "hover:bg-muted/30"
            }`}
          >
            <div className={`w-16 h-16 sm:w-[72px] sm:h-[72px] rounded-3xl flex items-center justify-center mb-5 transition-all duration-300 shadow-sm ${
              isDragging
                ? "bg-primary/15 scale-110 shadow-md"
                : "bg-gradient-to-b from-primary/15 to-primary/5 group-hover:scale-105"
            }`}>
              <CloudUpload className={`w-7 h-7 sm:w-8 sm:h-8 transition-colors ${isDragging ? "text-primary" : "text-primary/80 group-hover:text-primary"}`} />
            </div>
            <p className="text-[17px] font-semibold tracking-tight text-foreground mb-1.5 text-center px-2">
              {isDragging ? "Drop files here" : "Upload files"}
            </p>
            <p className="text-[13px] text-muted-foreground mb-5 text-center max-w-sm px-2">
              Drag and drop or click to browse
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground/70 px-2 text-center">
              <span className="flex items-center gap-1 whitespace-nowrap">
                <FileImage className="w-3 h-3 shrink-0" /> Images
              </span>
              <span className="text-border/70 select-none" aria-hidden>
                ·
              </span>
              <span className="flex items-center gap-1 whitespace-nowrap">
                <FileVideo className="w-3 h-3 shrink-0" /> Videos
              </span>
              <span className="text-border/70 select-none" aria-hidden>
                ·
              </span>
              <span className="whitespace-nowrap">Max {formatBytes(effectiveMaxSize)}</span>
            </div>
            {error && (
              <div className="mt-4 flex items-center gap-2 text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <>
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="w-[min(100%,calc(100vw-1rem))] max-w-[520px] sm:max-w-xl md:max-w-3xl lg:max-w-4xl rounded-3xl p-0 overflow-hidden max-h-[min(92dvh,900px)] flex flex-col gap-0 shadow-2xl border-border/60">

        <div
          className="relative flex-1 overflow-y-auto overflow-x-hidden min-h-0"
          ref={dropRef}
          onDragEnter={handleDragIn}
          onDragLeave={handleDragOut}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
            {isDragging && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/85 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-2 px-4 text-center">
                <CloudUpload className="w-10 h-10 text-primary animate-bounce" />
                <p className="text-sm font-medium text-foreground">Drop to add files</p>
              </div>
            </div>
          )}

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleMediaDragEnd}>
          <div className="flex min-h-0 h-full flex-col">
            <div className="flex shrink-0 flex-col gap-2 border-b border-border/60 bg-background/80 backdrop-blur-xl px-4 py-3 sm:flex-row sm:items-center sm:justify-between supports-[backdrop-filter]:bg-background/70">
              <div className="flex items-center gap-2">
                <p className="text-[15px] font-semibold tracking-tight text-foreground">Upload</p>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
                  {items.length}
                </span>
              </div>
              {videoCount > 0 ? (
                <Button
                  type="button"
                  variant={seriesOrganizerOpen ? "default" : "outline"}
                  size="sm"
                  className="h-9 gap-1.5 rounded-full px-4"
                  disabled={isUploadingBatch}
                  onClick={() => setSeriesOrganizerOpen((o) => !o)}
                >
                  <Layers className="h-3.5 w-3.5" />
                  {seriesOrganizerOpen ? "Done" : "Series organizer"}
                </Button>
              ) : null}
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)] lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
            <div className="border-b md:border-b-0 md:border-r border-border/60 bg-muted/20 p-3 sm:p-3.5 flex min-h-0 flex-col max-md:min-h-[min(42vh,320px)] md:h-full">
              <div className="mb-2.5 shrink-0 px-0.5">
                <span className="text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-[0.08em]">Library</span>
              </div>

              <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5 -mr-0.5 [scrollbar-gutter:stable]">
                  <div className="space-y-2">
                    {items.map((item) => {
                      const isActive = activeId === item.id
                      const lane = item.assignedSeriesLaneId
                        ? seriesLanes.find((l) => l.id === item.assignedSeriesLaneId)
                        : null
                      const laneBadge = lane && item.file.type.startsWith("video/") ? laneTitle(lane) : null
                      return (
                        <SortableFileRow
                          key={item.id}
                          item={item}
                          isActive={isActive}
                          laneBadge={laneBadge}
                          isUploadingBatch={isUploadingBatch}
                          onSelect={() => setActiveId(item.id)}
                          onRemove={() => removeItem(item.id)}
                          statusIcon={statusIcon}
                          formatBytes={formatBytes}
                        />
                      )
                    })}
                  </div>
                </div>
              </SortableContext>

              <div className="sticky bottom-0 z-10 mt-auto shrink-0 -mx-3 border-t border-border/60 bg-muted/20 px-3 pt-3 sm:-mx-3.5 sm:px-3.5 supports-[backdrop-filter]:bg-muted/15 backdrop-blur-md">
                <button
                  type="button"
                  onClick={openFilePicker}
                  disabled={isUploadingBatch}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 sm:py-2 rounded-2xl border border-dashed border-border/70 text-xs font-medium text-muted-foreground hover:text-primary hover:border-primary/50 hover:bg-primary/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] sm:min-h-0 touch-manipulation"
                >
                  <ImagePlus className="w-3.5 h-3.5 shrink-0" />
                  Add more
                </button>
              </div>
            </div>

            <div className="min-w-0 space-y-4 overflow-y-auto overflow-x-hidden p-4 sm:p-5 pb-6 sm:pb-5">
              {seriesOrganizerOpen ? (
                videoCount > 0 ? (
                  <div className="space-y-3 text-card-foreground">
                    <div className="rounded-2xl border border-border/60 bg-gradient-to-b from-card to-muted/30 p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                          <Layers className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-semibold tracking-tight text-foreground">Series organizer</p>
                          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                            Pick videos from your library to add to a group. Files stay in your library — order follows the library.
                          </p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        className="mt-3 h-9 w-full gap-1.5 rounded-full"
                        disabled={isUploadingBatch}
                        onClick={addSeriesLane}
                      >
                        <Plus className="w-3.5 h-3.5" />
                        New series group
                      </Button>
                    </div>
                    <div className="space-y-3 max-h-[min(56vh,420px)] overflow-y-auto overscroll-contain pr-0.5 -mr-0.5">
                      {seriesLanes.map((lane) => {
                        const assignedVideos = items.filter(
                          (i) => i.assignedSeriesLaneId === lane.id && i.file.type.startsWith("video/")
                        )
                        const assignedN = assignedVideos.length
                        return (
                          <LaneCard key={lane.id} disabled={isUploadingBatch}>
                            <div className="space-y-3 p-3.5">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-[14px] font-semibold tracking-tight leading-tight text-foreground truncate">{laneTitle(lane)}</p>
                                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                                    {assignedN} video{assignedN === 1 ? "" : "s"} in this group
                                  </p>
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:text-destructive"
                                  disabled={isUploadingBatch}
                                  onClick={() => removeSeriesLane(lane.id)}
                                  aria-label="Remove series group"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                              {(() => {
                                const videoLibrary = items.filter((i) => i.file.type.startsWith("video/"))
                                const isOpen = filePickerLaneId === lane.id
                                return (
                                  <div className="relative">
                                    <button
                                      type="button"
                                      disabled={isUploadingBatch || videoLibrary.length === 0}
                                      onClick={() => setFilePickerLaneId((prev) => (prev === lane.id ? null : lane.id))}
                                      className={cn(
                                        "flex w-full items-center justify-between gap-2 rounded-xl border border-border/70 bg-background px-3 py-2 text-[13px] transition-colors",
                                        "hover:bg-accent/60 disabled:opacity-50 disabled:cursor-not-allowed",
                                        isOpen && "ring-1 ring-primary/40 border-primary/40"
                                      )}
                                    >
                                      <span className="flex items-center gap-2 text-muted-foreground">
                                        <Plus className="h-3.5 w-3.5" />
                                        <span className="font-medium text-foreground">
                                          {assignedN === 0 ? "Add videos to this series" : `Edit videos (${assignedN})`}
                                        </span>
                                      </span>
                                      <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                                    </button>
                                    {isOpen && (
                                      <div className="absolute z-30 mt-1.5 w-full overflow-hidden rounded-2xl border border-border/70 bg-popover text-popover-foreground shadow-xl">
                                        <div className="max-h-[260px] overflow-y-auto overscroll-contain p-1.5">
                                          {videoLibrary.length === 0 ? (
                                            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                                              No videos in your library yet.
                                            </p>
                                          ) : (
                                            videoLibrary.map((it) => {
                                              const inThisLane = it.assignedSeriesLaneId === lane.id
                                              const inOtherLane = !!it.assignedSeriesLaneId && !inThisLane
                                              const otherLaneTitle = inOtherLane
                                                ? laneTitle(seriesLanes.find((l) => l.id === it.assignedSeriesLaneId)!)
                                                : null
                                              const still = it.customThumbnailPreview ?? it.videoPosterUrl
                                              return (
                                                <button
                                                  key={it.id}
                                                  type="button"
                                                  disabled={isUploadingBatch}
                                                  onClick={() => {
                                                    if (inThisLane) {
                                                      removeFileFromSeriesOrganizer(it.id)
                                                    } else {
                                                      assignFileToLane(it.id, lane.id)
                                                    }
                                                  }}
                                                  className={cn(
                                                    "flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors",
                                                    inThisLane ? "bg-primary/10" : "hover:bg-accent/60"
                                                  )}
                                                >
                                                  <span
                                                    className={cn(
                                                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                                                      inThisLane
                                                        ? "border-primary bg-primary text-primary-foreground"
                                                        : "border-border bg-background"
                                                    )}
                                                  >
                                                    {inThisLane && <Check className="h-3 w-3" />}
                                                  </span>
                                                  <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-muted ring-1 ring-border/60">
                                                    {still ? (
                                                      <img src={still} alt="" className="h-full w-full object-cover" />
                                                    ) : (
                                                      <div className="flex h-full w-full items-center justify-center">
                                                        <FileVideo className="h-4 w-4 text-muted-foreground" />
                                                      </div>
                                                    )}
                                                  </div>
                                                  <div className="min-w-0 flex-1">
                                                    <p className="truncate text-[12px] font-medium text-foreground">{it.file.name}</p>
                                                    {inOtherLane && (
                                                      <p className="truncate text-[10px] text-muted-foreground">
                                                        Currently in: {otherLaneTitle}
                                                      </p>
                                                    )}
                                                  </div>
                                                </button>
                                              )
                                            })
                                          )}
                                        </div>
                                        <div className="flex items-center justify-end gap-2 border-t border-border/60 bg-muted/30 px-2 py-1.5">
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            className="h-7 rounded-full px-3 text-xs"
                                            onClick={() => setFilePickerLaneId(null)}
                                          >
                                            Done
                                          </Button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )
                              })()}
                              {assignedVideos.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {assignedVideos.map((it) => (
                                    <span
                                      key={it.id}
                                      className="inline-flex max-w-full items-center gap-1 rounded-full border border-border/70 bg-muted/60 py-1 pl-2.5 pr-1 text-[11px]"
                                    >
                                      <span className="truncate max-w-[200px] font-medium">{it.file.name}</span>
                                      <button
                                        type="button"
                                        className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                                        disabled={isUploadingBatch}
                                        onClick={() => removeFileFromSeriesOrganizer(it.id)}
                                        aria-label={`Remove ${it.file.name} from this series`}
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              )}
                              <div className="flex gap-0.5 overflow-hidden rounded-xl border border-border bg-muted/40 p-0.5">
                                <button
                                  type="button"
                                  disabled={isUploadingBatch}
                                  onClick={() =>
                                    patchLaneAndSync(lane.id, {
                                      seriesMode: "create",
                                      seriesSelected: null,
                                      seriesEpisodeSubmode: null,
                                      seriesEpisodeId: null,
                                      seriesParentEpisodeId: null,
                                      seriesEpisodesList: [],
                                    })
                                  }
                                  className={cn(
                                    "flex-1 rounded-lg py-2 text-xs font-medium transition-colors",
                                    lane.seriesMode === "create"
                                      ? "bg-background text-foreground shadow-sm"
                                      : "text-muted-foreground hover:text-foreground"
                                  )}
                                >
                                  New series
                                </button>
                                <button
                                  type="button"
                                  disabled={isUploadingBatch}
                                  onClick={() =>
                                    patchLaneAndSync(lane.id, {
                                      seriesMode: "existing",
                                      seriesEpisodeName: "",
                                      seriesEpisodeId: null,
                                      seriesParentEpisodeId: null,
                                    })
                                  }
                                  className={cn(
                                    "flex-1 rounded-lg py-2 text-xs font-medium transition-colors",
                                    lane.seriesMode === "existing"
                                      ? "bg-background text-foreground shadow-sm"
                                      : "text-muted-foreground hover:text-foreground"
                                  )}
                                >
                                  Existing
                                </button>
                              </div>
                              {lane.seriesMode === "create" && (
                                <p className="text-[11px] leading-relaxed text-muted-foreground">
                                  Episode titles: Episode 1, 2… by order in the library list.
                                </p>
                              )}
                              {lane.seriesMode === "existing" && (
                                <div className="space-y-2">
                                  {lane.seriesSelected ? (
                                    <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm">
                                      <span className="truncate font-medium">{lane.seriesSelected.file_title}</span>
                                      <button
                                        type="button"
                                        className="shrink-0 text-xs text-primary hover:underline"
                                        disabled={isUploadingBatch}
                                        onClick={() => openSeriesBrowseForLane(lane.id)}
                                      >
                                        Change
                                      </button>
                                    </div>
                                  ) : (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-9 w-full rounded-xl"
                                      disabled={isUploadingBatch}
                                      onClick={() => openSeriesBrowseForLane(lane.id)}
                                    >
                                      Choose series…
                                    </Button>
                                  )}
                                  {lane.seriesSelected && (
                                    <>
                                      <div className="flex gap-0.5 overflow-hidden rounded-xl border border-border bg-muted/40 p-0.5">
                                        <button
                                          type="button"
                                          disabled={isUploadingBatch || lane.seriesEpisodesList.length === 0}
                                          onClick={() =>
                                            patchLaneAndSync(lane.id, {
                                              seriesEpisodeSubmode: "existing",
                                              seriesEpisodeName: "",
                                              seriesParentEpisodeId: null,
                                            })
                                          }
                                          className={cn(
                                            "flex-1 py-2 text-xs font-medium transition-colors",
                                            lane.seriesEpisodeSubmode === "existing"
                                              ? "bg-background shadow-sm"
                                              : "text-muted-foreground"
                                          )}
                                        >
                                          Pick episode
                                        </button>
                                        <button
                                          type="button"
                                          disabled={isUploadingBatch}
                                          onClick={() =>
                                            patchLaneAndSync(lane.id, {
                                              seriesEpisodeSubmode: "new",
                                              seriesEpisodeId: null,
                                              seriesParentEpisodeId: null,
                                            })
                                          }
                                          className={cn(
                                            "flex-1 py-2 text-xs font-medium transition-colors",
                                            lane.seriesEpisodeSubmode === "new"
                                              ? "bg-background shadow-sm"
                                              : "text-muted-foreground"
                                          )}
                                        >
                                          New episodes
                                        </button>
                                      </div>
                                      {lane.seriesEpisodeSubmode === "existing" && lane.seriesEpisodesList.length > 0 && (
                                        <select
                                          value={lane.seriesEpisodeId ?? ""}
                                          onChange={(e) =>
                                            patchLaneAndSync(lane.id, {
                                              seriesEpisodeId: e.target.value || null,
                                            })
                                          }
                                          disabled={isUploadingBatch}
                                          className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
                                        >
                                          <option value="">Select episode…</option>
                                          {lane.seriesEpisodesList.map((ep) => (
                                            <option key={ep.id} value={ep.id}>
                                              {ep.episode_name || ep.id.slice(0, 8)}
                                            </option>
                                          ))}
                                        </select>
                                      )}
                                      {lane.seriesEpisodeSubmode === "new" && (
                                        <p className="text-[11px] text-muted-foreground">
                                          New episode names: Episode 1, 2… by library order. Optional nest:
                                        </p>
                                      )}
                                      {lane.seriesEpisodeSubmode === "new" && lane.seriesEpisodesList.length > 0 && (
                                        <select
                                          value={lane.seriesParentEpisodeId ?? ""}
                                          onChange={(e) =>
                                            patchLaneAndSync(lane.id, {
                                              seriesParentEpisodeId: e.target.value || null,
                                            })
                                          }
                                          disabled={isUploadingBatch}
                                          className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
                                        >
                                          <option value="">Top-level only</option>
                                          {lane.seriesEpisodesList.map((ep) => (
                                            <option key={ep.id} value={ep.id}>
                                              {ep.episode_name || ep.id.slice(0, 8)}
                                            </option>
                                          ))}
                                        </select>
                                      )}
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          </LaneCard>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Add at least one video file to use the series organizer.</p>
                )
              ) : (
                <>
              {activeItem && (
                <div className="rounded-xl overflow-hidden bg-muted/50 border border-border shadow-sm">
                  {activeItem.file.type.startsWith("image/") ? (
                    <div className="relative w-full aspect-video max-h-[min(52vh,420px)] bg-muted/80 flex items-center justify-center">
                      <img
                        src={activeItem.previewUrl}
                        alt="Preview"
                        className="w-full h-full max-h-[min(52vh,420px)] object-contain"
                      />
                    </div>
                  ) : activeItem.file.type.startsWith("video/") ? (
                    videoPlaybackUrl ? (
                      <div className="relative w-full aspect-video max-h-[min(56vh,480px)] bg-muted">
                        <video
                          src={videoPlaybackUrl}
                          controls
                          className="w-full h-full max-h-[min(56vh,480px)] object-contain"
                          playsInline
                        />
                        <button
                          type="button"
                          onClick={stopVideoPlayback}
                          className="absolute top-2 right-2 sm:top-3 sm:right-3 z-10 h-10 w-10 sm:h-9 sm:w-9 rounded-full bg-secondary text-secondary-foreground hover:bg-secondary/90 flex items-center justify-center transition-colors touch-manipulation shadow-md border border-border"
                          aria-label="Back to thumbnail"
                        >
                          <X className="w-5 h-5 sm:w-4 sm:h-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={startVideoPlayback}
                        className="relative w-full aspect-video max-h-[min(52vh,420px)] bg-muted/80 overflow-hidden group flex flex-col items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background touch-manipulation min-h-[180px]"
                        aria-label="Play video preview"
                      >
                        {activeVideoPosterBusy ? (
                          <Loader2 className="w-10 h-10 animate-spin text-muted-foreground" />
                        ) : activeVideoStill ? (
                          <>
                            <img
                              src={activeVideoStill}
                              alt=""
                              className="absolute inset-0 w-full h-full object-contain bg-muted"
                            />
                            <span className="absolute inset-0 bg-foreground/20 group-hover:bg-foreground/30 group-active:bg-foreground/35 transition-colors" />
                            <span className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-2 ring-background/80 group-hover:bg-primary/90 transition-colors">
                              <Play className="h-7 w-7 ml-0.5" fill="currentColor" />
                            </span>
                            <span className="sr-only">Play preview</span>
                          </>
                        ) : (
                          <div className="relative z-10 flex flex-col items-center gap-3 px-4 py-6">
                            <FileVideo className="w-11 h-11 sm:w-12 sm:h-12 text-muted-foreground" />
                            <p className="text-xs text-center text-muted-foreground max-w-[240px] leading-relaxed">
                              No thumbnail — tap play to preview the file
                            </p>
                            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-ring">
                              <Play className="h-7 w-7 ml-0.5" fill="currentColor" />
                            </span>
                          </div>
                        )}
                      </button>
                    )
                  ) : null}
                </div>
              )}

              <div className="space-y-3.5">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Title</label>
                  <Input
                    value={activeItem?.title || ""}
                    onChange={(e) => {
                      if (!activeItem) return
                      updateItem(activeItem.id, (current) => ({ ...current, title: e.target.value }))
                    }}
                    placeholder="Give your file a title"
                    maxLength={200}
                    disabled={isFieldDisabled}
                    className="text-sm h-11 sm:h-9 bg-muted/30 border-border/50 focus:bg-background transition-colors"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Description</label>
                  <Textarea
                    value={activeItem?.description || ""}
                    onChange={(e) => {
                      if (!activeItem) return
                      updateItem(activeItem.id, (current) => ({ ...current, description: e.target.value }))
                    }}
                    placeholder="Add a description..."
                    rows={2}
                    maxLength={1000}
                    disabled={isFieldDisabled}
                    className="text-sm resize-none bg-muted/30 border-border/50 focus:bg-background transition-colors"
                  />
                </div>

                {activeItem?.file.type.startsWith("video/") && (
                  <div className="space-y-2.5 rounded-2xl border border-border/60 bg-muted/20 p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs font-semibold tracking-tight text-foreground">Series</span>
                      </div>
                      {activeItem.assignedSeriesLaneId && (() => {
                        const lane = seriesLanes.find((l) => l.id === activeItem.assignedSeriesLaneId)
                        if (!lane) return null
                        return (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                            From organizer · {laneTitle(lane)}
                          </span>
                        )
                      })()}
                    </div>
                    <div className="flex flex-col gap-1">
                      {(["none", "create", "existing"] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          disabled={isFieldDisabled}
                          onClick={() => {
                            if (!activeItem) return
                            updateItemSeries(activeItem.id, (c) => {
                              if (mode === "none") return { ...c, ...clearSeriesFields() }
                              if (mode === "create") {
                                return {
                                  ...c,
                                  seriesMode: "create",
                                  seriesSelected: null,
                                  seriesEpisodeSubmode: null,
                                  seriesEpisodeId: null,
                                  seriesParentEpisodeId: null,
                                  seriesEpisodesList: [],
                                }
                              }
                              return {
                                ...c,
                                seriesMode: "existing",
                                seriesEpisodeName: "",
                                seriesEpisodeId: null,
                                seriesParentEpisodeId: null,
                                seriesEpisodesList: [],
                                seriesEpisodeSubmode: null,
                                seriesSelected: c.seriesSelected,
                              }
                            })
                          }}
                          className={cn(
                            "rounded-xl px-3 py-2 text-left text-sm transition-colors disabled:opacity-50 min-h-[40px] touch-manipulation",
                            activeItem.seriesMode === mode
                              ? "bg-primary text-primary-foreground shadow-sm"
                              : "bg-muted/40 hover:bg-muted/70 text-foreground"
                          )}
                        >
                          {mode === "none" && "None"}
                          {mode === "create" && "Create new series"}
                          {mode === "existing" && "Use existing series"}
                        </button>
                      ))}
                    </div>

                    {activeItem.seriesMode === "create" && (
                      <div className="space-y-1.5 pt-1">
                        <label className="text-[11px] font-medium text-muted-foreground">Episode name</label>
                        <Input
                          value={activeItem.seriesEpisodeName}
                          onChange={(e) =>
                            updateItemSeries(activeItem.id, (c) => ({ ...c, seriesEpisodeName: e.target.value }))
                          }
                          placeholder="e.g. Episode 1 — Pilot"
                          maxLength={500}
                          disabled={isFieldDisabled}
                          className="text-sm h-9 bg-background border-border/60"
                        />
                      </div>
                    )}

                    {activeItem.seriesMode === "existing" && (
                      <div className="space-y-2 pt-1">
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[11px] text-muted-foreground">Series</span>
                          {activeItem.seriesSelected ? (
                            <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background px-3 py-2 text-sm">
                              <span className="truncate font-medium">{activeItem.seriesSelected.file_title || "Series"}</span>
                              <button
                                type="button"
                                disabled={isFieldDisabled}
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
                              className="h-9 rounded-xl"
                              disabled={isFieldDisabled}
                              onClick={openSeriesBrowse}
                            >
                              Choose series…
                            </Button>
                          )}
                        </div>

                        {activeItem.seriesSelected && (
                          <>
                            <div className="flex gap-0.5 overflow-hidden rounded-xl border border-border/60 bg-muted/40 p-0.5">
                              <button
                                type="button"
                                disabled={isFieldDisabled || activeItem.seriesEpisodesList.length === 0}
                                onClick={() =>
                                  updateItemSeries(activeItem.id, (c) => ({
                                    ...c,
                                    seriesEpisodeSubmode: "existing",
                                    seriesEpisodeName: "",
                                    seriesParentEpisodeId: null,
                                  }))
                                }
                                className={cn(
                                  "flex-1 rounded-lg py-2 text-xs font-medium transition-colors disabled:opacity-40",
                                  activeItem.seriesEpisodeSubmode === "existing"
                                    ? "bg-background text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
                                )}
                              >
                                Pick episode
                              </button>
                              <button
                                type="button"
                                disabled={isFieldDisabled}
                                onClick={() =>
                                  updateItemSeries(activeItem.id, (c) => ({
                                    ...c,
                                    seriesEpisodeSubmode: "new",
                                    seriesEpisodeId: null,
                                    seriesParentEpisodeId: null,
                                  }))
                                }
                                className={cn(
                                  "flex-1 rounded-lg py-2 text-xs font-medium transition-colors",
                                  activeItem.seriesEpisodeSubmode === "new"
                                    ? "bg-background text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
                                )}
                              >
                                New episode
                              </button>
                            </div>

                            {activeItem.seriesEpisodeSubmode === "existing" &&
                              activeItem.seriesEpisodesList.length > 0 && (
                                <div className="space-y-1.5">
                                  <label className="text-[11px] font-medium text-muted-foreground">Episode</label>
                                  <select
                                    value={activeItem.seriesEpisodeId ?? ""}
                                    onChange={(e) =>
                                      updateItemSeries(activeItem.id, (c) => ({
                                        ...c,
                                        seriesEpisodeId: e.target.value || null,
                                      }))
                                    }
                                    disabled={isFieldDisabled}
                                    className="w-full h-9 rounded-xl border border-border/60 bg-background px-3 text-sm"
                                  >
                                    <option value="">Select episode…</option>
                                    {activeItem.seriesEpisodesList.map((ep) => (
                                      <option key={ep.id} value={ep.id}>
                                        {ep.episode_name || ep.id.slice(0, 8)}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}

                            {activeItem.seriesEpisodeSubmode === "new" && (
                              <div className="space-y-1.5">
                                <label className="text-[11px] font-medium text-muted-foreground">New episode name</label>
                                <Input
                                  value={activeItem.seriesEpisodeName}
                                  onChange={(e) =>
                                    updateItemSeries(activeItem.id, (c) => ({
                                      ...c,
                                      seriesEpisodeName: e.target.value,
                                    }))
                                  }
                                  placeholder="Episode name"
                                  maxLength={500}
                                  disabled={isFieldDisabled}
                                  className="text-sm h-9 bg-background border-border/60"
                                />
                                {activeItem.seriesEpisodesList.length > 0 && (
                                  <div className="space-y-1.5 pt-0.5">
                                    <label className="text-[11px] font-medium text-muted-foreground">
                                      Nest under (optional)
                                    </label>
                                    <select
                                      value={activeItem.seriesParentEpisodeId ?? ""}
                                      onChange={(e) =>
                                        updateItemSeries(activeItem.id, (c) => ({
                                          ...c,
                                          seriesParentEpisodeId: e.target.value || null,
                                        }))
                                      }
                                      disabled={isFieldDisabled}
                                      className="w-full h-9 rounded-xl border border-border/60 bg-background px-3 text-sm"
                                    >
                                      <option value="">Top-level episode</option>
                                      {activeItem.seriesEpisodesList.map((ep) => {
                                        const parent = ep.parent_episode_id
                                          ? activeItem.seriesEpisodesList.find((x) => x.id === ep.parent_episode_id)
                                          : null
                                        const label =
                                          parent != null
                                            ? `${ep.episode_name || ep.id.slice(0, 8)} (under ${parent.episode_name || parent.id.slice(0, 8)})`
                                            : ep.episode_name || ep.id.slice(0, 8)
                                        return (
                                          <option key={ep.id} value={ep.id}>
                                            {label}
                                          </option>
                                        )
                                      })}
                                    </select>
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <div className="space-y-1.5" ref={categoryRef}>
                  <label className="text-xs font-medium text-muted-foreground">Category</label>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => !isFieldDisabled && setShowCategoryDropdown((p) => !p)}
                      disabled={isFieldDisabled}
                      className="w-full flex items-center justify-between border border-border/50 rounded-lg px-3 py-2 text-sm bg-muted/30 hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[36px]"
                    >
                      <span className="flex flex-wrap gap-1 min-w-0 flex-1">
                        {activeItem && activeItem.categories.length > 0 ? (
                          activeItem.categories.map((cat) => (
                            <span
                              key={cat}
                              className="inline-flex items-center gap-1 bg-primary/10 text-primary text-[11px] font-medium px-2 py-0.5 rounded-md"
                            >
                              {cat}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  toggleCategory(cat)
                                }}
                                className="hover:text-destructive"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </span>
                          ))
                        ) : (
                          <span className="text-muted-foreground">Select categories...</span>
                        )}
                      </span>
                      <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-muted-foreground ml-2 transition-transform duration-200 ${showCategoryDropdown ? "rotate-180" : ""}`} />
                    </button>
                    {showCategoryDropdown && (
                      <div className="absolute z-50 mt-1 w-full min-w-0 left-0 right-0 bg-popover border border-border rounded-xl shadow-lg max-h-[min(45vh,240px)] overflow-y-auto overscroll-contain p-1">
                        {CATEGORY_OPTIONS.map((cat) => {
                          const selected = activeItem?.categories.includes(cat)
                          return (
                            <button
                              key={cat}
                              type="button"
                              onClick={() => toggleCategory(cat)}
                              className={`w-full text-left px-2.5 py-1.5 text-sm rounded-lg transition-colors ${
                                selected ? "bg-primary/10 text-primary font-medium" : "text-foreground hover:bg-muted/80"
                              }`}
                            >
                              <span className="flex items-center gap-2">
                                <span className={`w-4 h-4 rounded flex items-center justify-center text-[10px] transition-colors ${
                                  selected ? "bg-primary text-primary-foreground" : "border border-border"
                                }`}>
                                  {selected && <Check className="w-2.5 h-2.5" />}
                                </span>
                                {cat}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground">Tags</label>
                    {activeItem && (
                      <span className="text-[10px] text-muted-foreground/60 tabular-nums">{activeItem.tags.length}/15</span>
                    )}
                  </div>
                  <div className={`flex flex-wrap gap-1.5 border border-border/50 rounded-lg px-2.5 py-2 bg-muted/30 min-h-[36px] transition-colors focus-within:bg-background focus-within:border-ring ${isFieldDisabled ? "opacity-50 cursor-not-allowed" : ""}`}>
                    {activeItem?.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 bg-muted text-foreground text-[11px] font-medium px-2 py-0.5 rounded-md"
                      >
                        <Tag className="w-2.5 h-2.5 text-muted-foreground" />
                        {tag}
                        {!isFieldDisabled && (
                          <button
                            type="button"
                            onClick={() => removeTag(tag)}
                            className="hover:text-destructive ml-0.5"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </span>
                    ))}
                    <input
                      type="text"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={handleTagKeyDown}
                      onBlur={() => {
                        if (tagInput.trim()) {
                          addTag(tagInput)
                          setTagInput("")
                        }
                      }}
                      placeholder={activeItem?.tags.length ? "" : "Type and press Enter..."}
                      disabled={isFieldDisabled}
                      className="flex-1 min-w-[80px] bg-transparent outline-none text-sm placeholder:text-muted-foreground/60 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Visibility</label>
                  <div className="flex rounded-lg border border-border/50 overflow-hidden bg-muted/30">
                    <button
                      type="button"
                      onClick={() => {
                        if (!activeItem) return
                        updateItem(activeItem.id, (current) => ({ ...current, isPublic: true }))
                      }}
                      disabled={isFieldDisabled}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 sm:py-2 min-h-[44px] sm:min-h-0 text-sm font-medium transition-all disabled:cursor-not-allowed touch-manipulation ${
                        activeItem?.isPublic
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Public
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!activeItem) return
                        updateItem(activeItem.id, (current) => ({ ...current, isPublic: false }))
                      }}
                      disabled={isFieldDisabled}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 sm:py-2 min-h-[44px] sm:min-h-0 text-sm font-medium transition-all disabled:cursor-not-allowed touch-manipulation ${
                        !activeItem?.isPublic
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <EyeOff className="w-3.5 h-3.5" />
                      Private
                    </button>
                  </div>
                </div>

                {activeItem && !activeItem.file.type.startsWith("image/") && <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Thumbnail</label>
                  <input
                    ref={thumbInputRef}
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp"
                    onChange={handleThumbnailSelect}
                    className="hidden"
                  />
                  {activeItem?.customThumbnailPreview ? (
                    <div className="relative inline-flex rounded-lg overflow-hidden border border-border/50">
                      <img
                        src={activeItem.customThumbnailPreview}
                        alt="Custom thumbnail"
                        className="h-20 w-auto max-w-full object-contain rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={removeThumbnail}
                        disabled={isFieldDisabled}
                        className="absolute right-1 top-1 h-5 w-5 rounded-full bg-secondary text-secondary-foreground hover:bg-secondary/80 flex items-center justify-center border border-border shadow-sm"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => thumbInputRef.current?.click()}
                      disabled={isFieldDisabled}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-dashed border-border/50 bg-muted/30 text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ImagePlus className="w-3.5 h-3.5" />
                      Choose thumbnail
                    </button>
                  )}
                  <p className="text-[10px] text-muted-foreground/60">Optional. If not set, a frame from the video will be used.</p>
                </div>}

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Comments</label>
                  <div className="flex rounded-lg border border-border/50 overflow-hidden bg-muted/30">
                    <button
                      type="button"
                      onClick={() => {
                        if (!activeItem) return
                        updateItem(activeItem.id, (current) => ({ ...current, commentsEnabled: true }))
                      }}
                      disabled={isFieldDisabled}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 sm:py-2 min-h-[44px] sm:min-h-0 text-sm font-medium transition-all disabled:cursor-not-allowed touch-manipulation ${
                        activeItem?.commentsEnabled
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      On
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!activeItem) return
                        updateItem(activeItem.id, (current) => ({ ...current, commentsEnabled: false }))
                      }}
                      disabled={isFieldDisabled}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 sm:py-2 min-h-[44px] sm:min-h-0 text-sm font-medium transition-all disabled:cursor-not-allowed touch-manipulation ${
                        !activeItem?.commentsEnabled
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <MessageSquareOff className="w-3.5 h-3.5" />
                      Off
                    </button>
                  </div>
                  {activeItem?.commentsEnabled && (
                    <div className="space-y-1 pt-0.5">
                      <label className="text-[11px] font-medium text-muted-foreground">Max comments (optional)</label>
                      <Input
                        type="text"
                        inputMode="numeric"
                        placeholder="Unlimited"
                        value={activeItem.commentLimit != null ? String(activeItem.commentLimit) : ""}
                        onChange={(e) => {
                          const id = activeItem.id
                          const raw = e.target.value.replace(/\D/g, "").slice(0, 7)
                          if (!raw) {
                            updateItem(id, (c) => ({ ...c, commentLimit: null }))
                            return
                          }
                          const n = parseInt(raw, 10)
                          if (n >= 1 && n <= 1_000_000) {
                            updateItem(id, (c) => ({ ...c, commentLimit: n }))
                          }
                        }}
                        disabled={isFieldDisabled}
                        className="h-9 text-sm bg-muted/50"
                      />
                      <p className="text-[10px] text-muted-foreground/60">Leave empty for unlimited.</p>
                    </div>
                  )}
                </div>

              </div>
                </>
              )}
            </div>
          </div>
          </div>
          </DndContext>
        </div>

        {error && (
          <div className="px-4 sm:px-5 py-2.5 bg-destructive/5 border-t border-destructive/10 shrink-0">
            <p className="text-xs text-destructive flex items-start gap-2 leading-snug">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span className="min-w-0 break-words">{error}</span>
            </p>
          </div>
        )}

        {uploadResultBanner && (
          <div className="shrink-0 space-y-3 border-t border-border/60 bg-muted/20 px-4 py-3 sm:px-5">
            <p className="text-sm font-medium text-foreground">
              {uploadResultBanner.fail === 0
                ? `All ${uploadResultBanner.ok} upload(s) finished.`
                : `${uploadResultBanner.ok} succeeded · ${uploadResultBanner.fail} failed`}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Processing may continue in the background. New uploads appear on your profile when ready.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => {
                  const origin = typeof window !== "undefined" ? window.location.origin : ""
                  void navigator.clipboard?.writeText(origin).catch(() => {})
                }}
              >
                Copy site link
              </Button>
              {userProfile?.username ? (
                <Button type="button" variant="outline" size="sm" className="h-9" asChild>
                  <Link to={`/profile/${userProfile.username}`}>Your profile</Link>
                </Button>
              ) : null}
              {uploadResultBanner.fail > 0 ? (
                <Button type="button" variant="secondary" size="sm" className="h-9" onClick={clearFailedForRetry}>
                  Fix &amp; retry failed
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                className="h-9 rounded-full"
                onClick={() => {
                  setUploadResultBanner(null)
                  resetState()
                  onClose()
                }}
              >
                Done
              </Button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:flex sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 px-4 sm:px-5 pt-3 border-t border-border/60 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70 shrink-0 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground h-11 sm:h-9 px-3 sm:px-4 w-full sm:w-auto touch-manipulation"
            onClick={handleClose}
            disabled={isUploadingBatch}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-11 sm:h-9 px-5 sm:px-6 gap-2 font-medium w-full sm:w-auto touch-manipulation rounded-full shadow-sm"
            onClick={handleUpload}
            disabled={items.length === 0 || isUploadingBatch || !allSeriesFieldsReady || uploadResultBanner != null}
          >
            {isUploadingBatch ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="w-3.5 h-3.5" />
                Upload {items.length > 1 ? `${items.length} files` : ""}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog
      open={seriesBrowseOpen}
      onOpenChange={(open) => {
        setSeriesBrowseOpen(open)
        if (!open) setSeriesBrowseForLaneId(null)
      }}
    >
      <DialogContent className="w-[min(100%,calc(100vw-1.5rem))] max-w-md max-h-[min(88dvh,520px)] overflow-y-auto rounded-2xl flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="text-base">Your series</DialogTitle>
        </DialogHeader>
        <Input
          value={seriesSearch}
          onChange={(e) => setSeriesSearch(e.target.value)}
          placeholder="Search by title…"
          className="h-9 text-sm"
        />
        <div className="min-h-0 max-h-[min(50vh,280px)] overflow-y-auto overscroll-contain rounded-lg border border-border/50 divide-y divide-border/50">
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
                  const lid = seriesBrowseForLaneId
                  if (lid) {
                    patchLaneAndSync(lid, {
                      seriesMode: "existing",
                      seriesSelected: {
                        file_series_id: row.file_series_id,
                        file_title: row.file_title,
                      },
                    })
                    loadEpisodesForLane(lid, row.file_series_id)
                  } else if (activeItem) {
                    updateItemSeries(activeItem.id, (c) => ({
                      ...c,
                      seriesMode: "existing",
                      seriesSelected: {
                        file_series_id: row.file_series_id,
                        file_title: row.file_title,
                      },
                    }))
                    loadEpisodesForItem(activeItem.id, row.file_series_id)
                  }
                  setSeriesBrowseOpen(false)
                  setSeriesBrowseForLaneId(null)
                }}
              >
                <span className="font-medium line-clamp-2">{row.file_title || "Untitled"}</span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
    <SignInDialog
      open={signInOpen}
      onOpenChange={setSignInOpen}
      title="Sign in to upload"
      description="Create a free account or sign in to upload your photos, videos, and more."
    />
    </>
  )
}

export default MediaSelectionModal
