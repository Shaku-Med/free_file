import React, { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { Dialog, DialogContent, DialogFooter } from "~/components/ui/dialog"
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
  Tv2,
  PlusCircle,
  Search,
} from "lucide-react"
import { GenerateUniqueID } from "~/lib/GenerateUniqueID"
import { useFileContext } from "~/lib/Context/Context"
import { useNavigate } from "react-router"

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
  title: string
  description: string
  isPublic: boolean
  categories: string[]
  tags: string[]
  commentsEnabled: boolean
  /** null = unlimited when comments are on */
  commentLimit: number | null
  customThumbnail: File | null
  customThumbnailPreview: string | null
  status: UploadStatus
  progress: number
  statusText: string | null
  error: string | null
  jobId: string | null
  isLocked: boolean
  // Series fields — only used for video files
  seriesMode: "none" | "new" | "existing"
  seriesTitle: string
  seriesDesc: string
  seriesIsPublic: boolean
  existingSeriesId: string
  existingSeriesName: string
  episodeNumber: number | null
  seasonNumber: number | null
}

export const MediaSelectionModal: React.FC<MediaSelectionModalProps> = ({
  isOpen,
  onClose,
  onFilesSelected,
  maxFileSizeBytes,
  initialFiles,
  onFilesConsumed,
}) => {
  const { userId, c_user, uploadServerUrl } = useFileContext()
  const navigate = useNavigate()
  const [items, setItems] = useState<MediaItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isUploadingBatch, setIsUploadingBatch] = useState(false)
  const [tagInput, setTagInput] = useState("")
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const categoryRef = useRef<HTMLDivElement>(null)
  const itemsRef = useRef<MediaItem[]>([])
  const dropRef = useRef<HTMLDivElement>(null)
  const thumbInputRef = useRef<HTMLInputElement>(null)

  // Series picker — kept so `false &&` series UI below typechecks; unused until feature is re-enabled
  const [seriesList, setSeriesList] = useState<Array<{ id: string; title: string; episode_count?: number }>>([])
  const [seriesLoading, setSeriesLoading] = useState(false)
  const [seriesLoaded, setSeriesLoaded] = useState(false)
  const [seriesSearchQuery, setSeriesSearchQuery] = useState("")

  useEffect(() => {
    if (isOpen && !userId) {
      onClose()
      navigate('/auth/login')
    }
  }, [isOpen, userId, onClose, navigate])

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

  const effectiveMaxSize = maxFileSizeBytes ?? 4 * 1024 * 1024 * 1024

  const resetState = () => {
    items.forEach((item) => {
      URL.revokeObjectURL(item.previewUrl)
      if (item.customThumbnailPreview) URL.revokeObjectURL(item.customThumbnailPreview)
    })
    setItems([])
    setActiveId(null)
    setError(null)
    setIsUploadingBatch(false)
    setTagInput("")
    setShowCategoryDropdown(false)
    setIsDragging(false)
  }

  const loadUserSeries = useCallback(async () => {
    if (seriesLoaded || seriesLoading) return
    setSeriesLoading(true)
    try {
      const res = await fetch("/api/series", { headers: c_user ? { Authorization: `Bearer ${c_user}` } : {} })
      if (res.ok) {
        const json = await res.json() as { series?: Array<{ id: string; title: string; episode_count?: number }> }
        setSeriesList(json.series ?? [])
      }
    } catch {}
    setSeriesLoading(false)
    setSeriesLoaded(true)
  }, [seriesLoaded, seriesLoading, c_user])

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
    return {
      id: `${file.name}-${file.size}-${file.lastModified}-${GenerateUniqueID()}`,
      file,
      previewUrl: URL.createObjectURL(file),
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
      seriesTitle: "",
      seriesDesc: "",
      seriesIsPublic: true,
      existingSeriesId: "",
      existingSeriesName: "",
      episodeNumber: null,
      seasonNumber: null,
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

  const removeItem = (id: string) => {
    if (isUploadingBatch) return
    setItems((prev) => {
      const target = prev.find((item) => item.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
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
    // Revoke old preview
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
        // Strip data URL prefix to get raw base64
        resolve(result.split(",")[1] || result)
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  // --- Drag and drop ---
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

  // --- Upload logic (unchanged) ---
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

    // Convert custom thumbnail to base64 if provided
    let defaultThumbnailB64 = ""
    if (item.customThumbnail) {
      try {
        defaultThumbnailB64 = await fileToBase64(item.customThumbnail)
      } catch {
        // Ignore thumbnail errors — upload continues without it
      }
    }

    /* Series payload — disabled; re-enable with upload-job-status series webhook
    const isVideoFile =
      item.file.type.startsWith("video/") ||
      item.file.type === "application/vnd.apple.mpegurl" ||
      /\.(mp4|webm|mov|mkv|avi|m4v|m3u8|ogv)$/i.test(item.file.name || "")
    const seriesPayload: Record<string, unknown> = {}
    if (isVideoFile && item.seriesMode === "new" && item.seriesTitle.trim()) {
      seriesPayload.is_series_main = true
      seriesPayload.series_title = item.seriesTitle.trim()
      seriesPayload.series_desc = item.seriesDesc.trim()
      seriesPayload.series_is_public = item.seriesIsPublic
    } else if (isVideoFile && item.seriesMode === "existing" && item.existingSeriesId.trim()) {
      seriesPayload.series_id = item.existingSeriesId.trim()
      if (item.episodeNumber != null) seriesPayload.episode_number = item.episodeNumber
      if (item.seasonNumber != null) seriesPayload.season_number = item.seasonNumber
    }
    */

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
          // ...seriesPayload, // series disabled
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
    const allSucceeded = successfulUploads > 0 && successfulUploads === snapshot.length
    if (allSucceeded) {
      resetState()
      onClose()
    }
  }

  const handleClose = () => {
    if (isUploadingBatch) return
    setError(null)
    resetState()
    onClose()
  }

  const activeItem = useMemo(() => items.find((item) => item.id === activeId) || items[0], [items, activeId])

  const isFieldDisabled = !activeItem || isUploadingBatch || !!activeItem?.isLocked

  const statusIcon = (status: UploadStatus) => {
    switch (status) {
      case "uploading": return <Loader2 className="w-3 h-3 animate-spin text-primary" />
      case "success": return <Check className="w-3 h-3 text-green-500" />
      case "error": return <AlertCircle className="w-3 h-3 text-destructive" />
      default: return null
    }
  }

  // --- No files: show drop zone ---
  if (items.length === 0) {
    return (
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent
          className="w-[94vw] max-w-lg rounded-2xl p-0 overflow-hidden"
          showCloseButton={true}
        >
          <div
            ref={dropRef}
            onDragEnter={handleDragIn}
            onDragLeave={handleDragOut}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={openFilePicker}
            className={`cursor-pointer group flex flex-col items-center justify-center p-10 sm:p-14 transition-all duration-200 ${
              isDragging
                ? "bg-primary/5 ring-2 ring-primary/30 ring-inset"
                : "hover:bg-muted/40"
            }`}
          >
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-5 transition-all duration-200 ${
              isDragging
                ? "bg-primary/15 scale-110"
                : "bg-primary/10 group-hover:bg-primary/15 group-hover:scale-105"
            }`}>
              <CloudUpload className={`w-7 h-7 transition-colors ${isDragging ? "text-primary" : "text-primary/70 group-hover:text-primary"}`} />
            </div>
            <p className="text-base font-semibold text-foreground mb-1">
              {isDragging ? "Drop files here" : "Upload files"}
            </p>
            <p className="text-sm text-muted-foreground mb-5 text-center">
              Drag and drop or click to browse
            </p>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70">
              <span className="flex items-center gap-1">
                <FileImage className="w-3 h-3" /> Images
              </span>
              <span className="w-px h-3 bg-border" />
              <span className="flex items-center gap-1">
                <FileVideo className="w-3 h-3" /> Videos
              </span>
              <span className="w-px h-3 bg-border" />
              <span>Max {formatBytes(effectiveMaxSize)}</span>
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

  // --- Has files: show editor ---
  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="w-[96vw] max-w-[520px] sm:max-w-xl md:max-w-3xl lg:max-w-4xl rounded-2xl p-0 overflow-hidden max-h-[90vh] flex flex-col gap-0">

        {/* Main content */}
        <div
          className="flex-1 overflow-y-auto min-h-0"
          ref={dropRef}
          onDragEnter={handleDragIn}
          onDragLeave={handleDragOut}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          {/* Drag overlay */}
          {isDragging && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-2">
                <CloudUpload className="w-10 h-10 text-primary animate-bounce" />
                <p className="text-sm font-medium text-foreground">Drop to add files</p>
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-[220px_1fr] h-full">
            {/* Left panel — File list */}
            <div className="border-b md:border-b-0 md:border-r border-border bg-muted/30 p-3 flex flex-col">
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Files</span>
                <span className="text-[10px] text-muted-foreground/60 bg-muted rounded-full px-2 py-0.5 tabular-nums">{items.length}</span>
              </div>

              {/* File items */}
              <div className="space-y-1.5 flex-1 overflow-y-auto max-h-[25vh] md:max-h-[340px] pr-0.5">
                {items.map((item) => {
                  const isActive = activeId === item.id
                  const isVideo = item.file.type.startsWith("video/")
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveId(item.id)}
                      className={`w-full text-left rounded-xl p-2 transition-all duration-150 flex items-center gap-2.5 group/item ${
                        isActive
                          ? "bg-primary/10 ring-1 ring-primary/20"
                          : "hover:bg-muted/80"
                      }`}
                    >
                      {/* Mini thumbnail */}
                      <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-muted shrink-0">
                        {isVideo ? (
                          <video
                            src={item.previewUrl}
                            className="w-full h-full object-cover"
                            muted
                            preload="metadata"
                          />
                        ) : (
                          <img
                            src={item.previewUrl}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        )}
                        {item.status !== "idle" && (
                          <div className={`absolute inset-0 flex items-center justify-center ${
                            item.status === "success" ? "bg-green-500/20" : item.status === "error" ? "bg-destructive/20" : "bg-black/30"
                          }`}>
                            {statusIcon(item.status)}
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground line-clamp-1">{item.file.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate leading-tight mt-0.5">
                          {formatBytes(item.file.size)}
                          {item.status === "uploading" && ` · ${item.progress}%`}
                        </p>
                        {item.status === "uploading" && (
                          <Progress value={item.progress} className="h-0.5 mt-1" />
                        )}
                        {item.error && (
                          <p className="text-[10px] text-destructive truncate mt-0.5">{item.error}</p>
                        )}
                      </div>

                      {/* Remove */}
                      {!isUploadingBatch && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            removeItem(item.id)
                          }}
                          className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center opacity-0 group-hover/item:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-all"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Add more button */}
              <button
                type="button"
                onClick={openFilePicker}
                disabled={isUploadingBatch}
                className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ImagePlus className="w-3.5 h-3.5" />
                Add more
              </button>
            </div>

            {/* Right panel — Preview + Details */}
            <div className="p-4 md:p-5 space-y-4 overflow-y-auto">
              {/* Preview */}
              {activeItem && (
                <div className="rounded-xl overflow-hidden bg-muted/50 border border-border/50">
                  {activeItem.file.type.startsWith("image/") ? (
                    <div className="relative w-full aspect-video bg-muted/80 flex items-center justify-center">
                      <img
                        src={activeItem.previewUrl}
                        alt="Preview"
                        className="w-full h-full object-contain"
                      />
                    </div>
                  ) : activeItem.file.type.startsWith("video/") ? (
                    <div className="relative w-full aspect-video bg-black rounded-t-xl">
                      <video
                        src={activeItem.previewUrl}
                        controls
                        className="w-full h-full object-contain"
                        preload="metadata"
                      />
                    </div>
                  ) : null}
                </div>
              )}

              {/* Form fields */}
              <div className="space-y-3.5">
                {/* Title */}
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
                    className="text-sm h-9 bg-muted/30 border-border/50 focus:bg-background transition-colors"
                  />
                </div>

                {/* Description */}
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

                {/* Category */}
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
                      <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-xl shadow-lg max-h-[180px] overflow-y-auto p-1">
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

                {/* Tags */}
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

                {/* Visibility */}
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
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium transition-all disabled:cursor-not-allowed ${
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
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium transition-all disabled:cursor-not-allowed ${
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

                {/* Custom Thumbnail — only for video/audio, not images */}
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
                        className="absolute right-1 top-1 h-5 w-5 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center"
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

                {/* Comments toggle */}
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
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium transition-all disabled:cursor-not-allowed ${
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
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium transition-all disabled:cursor-not-allowed ${
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

                {false /** SERIES UI off — use `activeItem &&` instead of `false &&` to re-enable (restore state + loadUserSeries + seriesPayload) */ &&
                  activeItem &&
                  activeItem.file.type.startsWith("video/") && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Tv2 className="w-3.5 h-3.5 text-muted-foreground" />
                      <label className="text-xs font-medium text-muted-foreground">Series</label>
                    </div>

                    {/* Mode selector */}
                    <div className="flex rounded-lg border border-border/50 overflow-hidden bg-muted/30">
                      {(["none", "new", "existing"] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          disabled={isFieldDisabled}
                          onClick={() =>
                            updateItem(activeItem.id, (c) => ({ ...c, seriesMode: mode }))
                          }
                          className={`flex-1 py-2 text-xs font-medium transition-all disabled:cursor-not-allowed ${
                            activeItem.seriesMode === mode
                              ? "bg-primary text-primary-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {mode === "none" ? "None" : mode === "new" ? "New series" : "Existing"}
                        </button>
                      ))}
                    </div>

                    {/* New series fields */}
                    {activeItem.seriesMode === "new" && (
                      <div className="space-y-2 pt-0.5">
                        <Input
                          placeholder="Series title *"
                          maxLength={200}
                          value={activeItem.seriesTitle}
                          onChange={(e) =>
                            updateItem(activeItem.id, (c) => ({ ...c, seriesTitle: e.target.value }))
                          }
                          disabled={isFieldDisabled}
                          className="text-sm h-9 bg-muted/30 border-border/50 focus:bg-background"
                        />
                        <Textarea
                          placeholder="Series description (optional)"
                          rows={2}
                          maxLength={1000}
                          value={activeItem.seriesDesc}
                          onChange={(e) =>
                            updateItem(activeItem.id, (c) => ({ ...c, seriesDesc: e.target.value }))
                          }
                          disabled={isFieldDisabled}
                          className="text-sm resize-none bg-muted/30 border-border/50 focus:bg-background"
                        />
                        <div className="flex rounded-lg border border-border/50 overflow-hidden bg-muted/30">
                          {[true, false].map((pub) => (
                            <button
                              key={String(pub)}
                              type="button"
                              disabled={isFieldDisabled}
                              onClick={() =>
                                updateItem(activeItem.id, (c) => ({ ...c, seriesIsPublic: pub }))
                              }
                              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-all disabled:cursor-not-allowed ${
                                activeItem.seriesIsPublic === pub
                                  ? "bg-primary text-primary-foreground shadow-sm"
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {pub ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                              {pub ? "Public series" : "Private series"}
                            </button>
                          ))}
                        </div>
                        <p className="text-[10px] text-muted-foreground/60">
                          This file will be the main entry shown in feeds.
                        </p>
                      </div>
                    )}

                    {/* Existing series — search & select */}
                    {activeItem.seriesMode === "existing" && (
                      <div className="space-y-2 pt-0.5">
                        {/* Selected badge */}
                        {activeItem.existingSeriesId ? (
                          <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-primary/8 border border-primary/20">
                            <div className="flex items-center gap-2 min-w-0">
                              <Tv2 className="w-3.5 h-3.5 text-primary shrink-0" />
                              <span className="text-xs font-medium text-primary truncate">{activeItem.existingSeriesName || activeItem.existingSeriesId}</span>
                            </div>
                            <button
                              type="button"
                              disabled={isFieldDisabled}
                              onClick={() => updateItem(activeItem.id, (c) => ({ ...c, existingSeriesId: "", existingSeriesName: "" }))}
                              className="shrink-0 text-muted-foreground hover:text-destructive transition-colors disabled:cursor-not-allowed"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            {/* Search input */}
                            <div className="relative">
                              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                              <Input
                                placeholder="Search your series..."
                                value={seriesSearchQuery}
                                onChange={(e) => setSeriesSearchQuery(e.target.value)}
                                onFocus={() => loadUserSeries()}
                                disabled={isFieldDisabled}
                                className="text-sm h-9 bg-muted/30 border-border/50 focus:bg-background pl-8"
                              />
                            </div>
                            {/* Results list */}
                            <div className="rounded-lg border border-border/50 overflow-hidden max-h-[160px] overflow-y-auto bg-background">
                              {seriesLoading ? (
                                <div className="flex items-center justify-center gap-2 py-5 text-xs text-muted-foreground">
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  Loading...
                                </div>
                              ) : seriesList.length === 0 ? (
                                <p className="text-center text-xs text-muted-foreground py-5">
                                  No series found. Create one first.
                                </p>
                              ) : (() => {
                                const q = seriesSearchQuery.trim().toLowerCase()
                                const filtered = q
                                  ? seriesList.filter((s) => s.title.toLowerCase().includes(q))
                                  : seriesList
                                return filtered.length === 0 ? (
                                  <p className="text-center text-xs text-muted-foreground py-4">No match</p>
                                ) : (
                                  filtered.map((s) => (
                                    <button
                                      key={s.id}
                                      type="button"
                                      disabled={isFieldDisabled}
                                      onClick={() => {
                                        updateItem(activeItem.id, (c) => ({
                                          ...c,
                                          existingSeriesId: s.id,
                                          existingSeriesName: s.title,
                                        }))
                                        setSeriesSearchQuery("")
                                      }}
                                      className="w-full text-left flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-muted/70 transition-colors border-b border-border/30 last:border-b-0 disabled:cursor-not-allowed"
                                    >
                                      <span className="truncate font-medium">{s.title}</span>
                                      {s.episode_count != null && (
                                        <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                                          {s.episode_count} ep
                                        </span>
                                      )}
                                    </button>
                                  ))
                                )
                              })()}
                            </div>
                          </div>
                        )}

                        {/* Season / Episode numbers — shown once a series is selected */}
                        {activeItem.existingSeriesId && (
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <label className="text-[11px] text-muted-foreground">Season</label>
                              <Input
                                type="text"
                                inputMode="numeric"
                                placeholder="1"
                                value={activeItem.seasonNumber != null ? String(activeItem.seasonNumber) : ""}
                                onChange={(e) => {
                                  const raw = e.target.value.replace(/\D/g, "").slice(0, 3)
                                  const n = raw ? parseInt(raw, 10) : null
                                  updateItem(activeItem.id, (c) => ({
                                    ...c,
                                    seasonNumber: n !== null && n >= 1 && n <= 999 ? n : null,
                                  }))
                                }}
                                disabled={isFieldDisabled}
                                className="text-sm h-9 bg-muted/30 border-border/50"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[11px] text-muted-foreground">Episode</label>
                              <Input
                                type="text"
                                inputMode="numeric"
                                placeholder="1"
                                value={activeItem.episodeNumber != null ? String(activeItem.episodeNumber) : ""}
                                onChange={(e) => {
                                  const raw = e.target.value.replace(/\D/g, "").slice(0, 4)
                                  const n = raw ? parseInt(raw, 10) : null
                                  updateItem(activeItem.id, (c) => ({
                                    ...c,
                                    episodeNumber: n !== null && n >= 1 && n <= 9999 ? n : null,
                                  }))
                                }}
                                disabled={isFieldDisabled}
                                className="text-sm h-9 bg-muted/30 border-border/50"
                              />
                            </div>
                          </div>
                        )}

                        <p className="text-[10px] text-muted-foreground/60">
                          This file will be hidden from feeds and linked to the series.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Error bar */}
        {error && (
          <div className="px-5 py-2 bg-destructive/5 border-t border-destructive/10">
            <p className="text-xs text-destructive flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-t border-border bg-muted/20 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground h-9 px-4"
            onClick={handleClose}
            disabled={isUploadingBatch}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-9 px-6 gap-2 font-medium"
            onClick={handleUpload}
            disabled={items.length === 0 || isUploadingBatch}
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
  )
}

export default MediaSelectionModal
