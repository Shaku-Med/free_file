import React, { useEffect, useMemo, useRef, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "~/components/ui/dialog"
import { Button } from "~/components/ui/button"
import { Progress } from "~/components/ui/progress"
import { Input } from "~/components/ui/input"
import { Textarea } from "~/components/ui/textarea"
import { Upload, X, FileImage, FileVideo, Trash2, ChevronDown, Tag } from "lucide-react"
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
  status: UploadStatus
  progress: number
  statusText: string | null
  error: string | null
  jobId: string | null
  isLocked: boolean
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
  const categoryRef = useRef<HTMLDivElement>(null)
  const itemsRef = useRef<MediaItem[]>([])

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

  const effectiveMaxSize = maxFileSizeBytes ?? 40 * 1024 * 1024

  const resetState = () => {
    items.forEach((item) => {
      URL.revokeObjectURL(item.previewUrl)
    })
    setItems([])
    setActiveId(null)
    setError(null)
    setIsUploadingBatch(false)
    setTagInput("")
    setShowCategoryDropdown(false)
  }

  const formatBytes = (bytes: number) => {
    if (!bytes) return "0 B"
    const k = 1024
    const sizes = ["B", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    const value = bytes / Math.pow(k, i)
    return `${value.toFixed(2)} ${sizes[i]}`
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
      status: "idle",
      progress: 0,
      statusText: null,
      error: null,
      jobId: null,
      isLocked: false,
    }
  }

  const addFiles = (files: File[]) => {
    if (files.length === 0 || isUploadingBatch) {
      return
    }
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

    if (nextItems.length === 0) {
      return
    }

    setItems((prev) => {
      const updated = [...prev, ...nextItems]
      if (!activeId) {
        setActiveId(nextItems[0]?.id || null)
      }
      return updated
    })
  }

  const handleFileChange = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || isUploadingBatch) {
      return
    }
    addFiles(Array.from(fileList))
  }

  const updateItem = (id: string, updater: (item: MediaItem) => MediaItem) => {
    setItems((prev) => prev.map((item) => (item.id === id ? updater(item) : item)))
  }

  const removeItem = (id: string) => {
    if (isUploadingBatch) return
    setItems((prev) => {
      const target = prev.find((item) => item.id === id)
      if (target) {
        URL.revokeObjectURL(target.previewUrl)
      }
      const next = prev.filter((item) => item.id !== id)
      if (activeId === id) {
        setActiveId(next[0]?.id || null)
      }
      return next
    })
  }

  const toggleCategory = (cat: string) => {
    if (!activeItem) return
    updateItem(activeItem.id, (current) => {
      const has = current.categories.includes(cat)
      return {
        ...current,
        categories: has
          ? current.categories.filter((c) => c !== cat)
          : [...current.categories, cat],
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
      if (item.title.trim().length > 0) {
        formData.append("title", item.title.trim())
      }
      if (item.description.trim().length > 0) {
        formData.append("description", item.description.trim())
      }
      formData.append("isPublic", String(item.isPublic))
      if (item.categories.length > 0) {
        formData.append("categories", JSON.stringify(item.categories))
      }
      if (item.tags.length > 0) {
        formData.append("tags", JSON.stringify(item.tags))
      }

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
    if (isUploadingBatch) {
      return
    }
    setError(null)
    resetState()
    onClose()
  }

  const activeItem = useMemo(() => items.find((item) => item.id === activeId) || items[0], [items, activeId])

  const renderFileIcon = (file?: File) => {
    if (!file) return <Upload className="w-8 h-8 text-primary" />
    if (file.type.startsWith("image/")) return <FileImage className="w-8 h-8 text-primary" />
    if (file.type.startsWith("video/")) return <FileVideo className="w-8 h-8 text-primary" />
    return <Upload className="w-8 h-8 text-primary" />
  }

  const isFieldDisabled = !activeItem || isUploadingBatch || !!activeItem?.isLocked

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="w-[96vw] max-w-[520px] sm:max-w-xl md:max-w-3xl lg:max-w-4xl xl:max-w-5xl rounded-2xl sm:rounded-3xl p-0 overflow-hidden max-h-[92vh] flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
          <DialogTitle className="text-lg font-semibold text-center">Add Media</DialogTitle>
          <DialogDescription className="text-center text-sm text-muted-foreground">
            Upload images or videos.
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-4 space-y-4 overflow-y-auto min-h-0 flex-1">
          <div className="grid gap-4 md:grid-cols-[200px_1fr]">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-foreground">Selected files</p>
                <span className="text-xs text-muted-foreground">{items.length}</span>
              </div>
              <div className="space-y-2 max-h-[30vh] md:max-h-[320px] overflow-y-auto pr-1">
                {items.length === 0 && (
                  <div className="border border-dashed rounded-2xl p-4 text-center">
                    <div className="flex items-center justify-center mb-3">
                      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                        {renderFileIcon()}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">No files selected</p>
                  </div>
                )}
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveId(item.id)}
                    className={`w-full text-left border rounded-2xl p-3 transition-colors ${
                      activeId === item.id ? "border-primary/70 bg-primary/5" : "border-border bg-muted/40 hover:border-primary/40"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{item.file.name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {formatBytes(item.file.size)} · {item.isPublic ? "Public" : "Private"}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0"
                        onClick={(event) => {
                          event.stopPropagation()
                          removeItem(item.id)
                        }}
                        disabled={isUploadingBatch}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    {item.status !== "idle" && (
                      <div className="mt-2 space-y-1">
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span className="truncate">{item.statusText || item.status}</span>
                          <span className="shrink-0 ml-1">{item.progress}%</span>
                        </div>
                        <Progress value={item.progress} className="h-1.5" />
                      </div>
                    )}
                    {item.error && (
                      <p className="mt-1 text-[11px] text-destructive truncate">{item.error}</p>
                    )}
                  </button>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full rounded-full"
                onClick={() => {
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
                }}
                disabled={isUploadingBatch}
              >
                Add files
              </Button>
            </div>

            <div className="space-y-3 min-w-0">
              {activeItem ? (
                <div className="border border-border rounded-2xl overflow-hidden bg-muted/50">
                  {activeItem.file.type.startsWith("image/") ? (
                    <div className="relative w-full aspect-video bg-muted flex items-center justify-center">
                      <img
                        src={activeItem.previewUrl}
                        alt="Preview"
                        className="w-full h-full object-contain"
                      />
                    </div>
                  ) : activeItem.file.type.startsWith("video/") ? (
                    <div className="relative w-full aspect-video bg-black">
                      <video
                        src={activeItem.previewUrl}
                        controls
                        className="w-full h-full object-contain"
                        preload="metadata"
                      />
                    </div>
                  ) : null}
                  <div className="p-3 border-t border-border">
                    <p className="text-xs font-medium text-foreground truncate">{activeItem.file.name}</p>
                    <p className="text-xs text-muted-foreground">{formatBytes(activeItem.file.size)}</p>
                  </div>
                </div>
              ) : (
                <div className="border border-dashed rounded-2xl p-6 text-center">
                  <div className="flex items-center justify-center mb-4">
                    <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                      {renderFileIcon()}
                    </div>
                  </div>
                  <p className="text-sm font-medium mb-1">
                    Choose files to preview
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Allowed types: image/*, video/*.
                  </p>
                </div>
              )}

              <div className="space-y-3 text-left">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground">Title</p>
                  <Input
                    value={activeItem?.title || ""}
                    onChange={(e) => {
                      if (!activeItem) return
                      updateItem(activeItem.id, (current) => ({ ...current, title: e.target.value }))
                    }}
                    placeholder="Enter a title for this file"
                    maxLength={200}
                    disabled={isFieldDisabled}
                    className="text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground">Description</p>
                  <Textarea
                    value={activeItem?.description || ""}
                    onChange={(e) => {
                      if (!activeItem) return
                      updateItem(activeItem.id, (current) => ({ ...current, description: e.target.value }))
                    }}
                    placeholder="Describe this file"
                    rows={2}
                    maxLength={1000}
                    disabled={isFieldDisabled}
                    className="text-sm resize-none"
                  />
                </div>

                <div className="space-y-1" ref={categoryRef}>
                  <p className="text-xs font-medium text-foreground">Category</p>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => !isFieldDisabled && setShowCategoryDropdown((p) => !p)}
                      disabled={isFieldDisabled}
                      className="w-full flex items-center justify-between border border-input rounded-md px-3 py-2 text-sm bg-background hover:bg-accent/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[38px]"
                    >
                      <span className="flex flex-wrap gap-1 min-w-0 flex-1">
                        {activeItem && activeItem.categories.length > 0 ? (
                          activeItem.categories.map((cat) => (
                            <span
                              key={cat}
                              className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full"
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
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ))
                        ) : (
                          <span className="text-muted-foreground">Select categories...</span>
                        )}
                      </span>
                      <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground ml-2" />
                    </button>
                    {showCategoryDropdown && (
                      <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-lg shadow-lg max-h-[180px] overflow-y-auto">
                        {CATEGORY_OPTIONS.map((cat) => {
                          const selected = activeItem?.categories.includes(cat)
                          return (
                            <button
                              key={cat}
                              type="button"
                              onClick={() => toggleCategory(cat)}
                              className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-accent ${
                                selected ? "bg-primary/10 text-primary font-medium" : "text-foreground"
                              }`}
                            >
                              <span className="flex items-center gap-2">
                                <span className={`w-4 h-4 rounded border flex items-center justify-center text-xs ${
                                  selected ? "bg-primary border-primary text-primary-foreground" : "border-input"
                                }`}>
                                  {selected && "✓"}
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

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-foreground">Tags</p>
                    {activeItem && (
                      <span className="text-[11px] text-muted-foreground">{activeItem.tags.length}/15</span>
                    )}
                  </div>
                  <div className={`flex flex-wrap gap-1.5 border border-input rounded-md px-3 py-2 bg-background min-h-[38px] ${isFieldDisabled ? "opacity-50 cursor-not-allowed" : ""}`}>
                    {activeItem?.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 bg-muted text-foreground text-xs px-2 py-0.5 rounded-full"
                      >
                        <Tag className="w-3 h-3" />
                        {tag}
                        {!isFieldDisabled && (
                          <button
                            type="button"
                            onClick={() => removeTag(tag)}
                            className="hover:text-destructive"
                          >
                            <X className="w-3 h-3" />
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
                      className="flex-1 min-w-[100px] bg-transparent outline-none text-sm placeholder:text-muted-foreground disabled:cursor-not-allowed"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">Press Enter or comma to add a tag</p>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-foreground">Visibility</p>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant={activeItem?.isPublic ? "default" : "outline"}
                      className="rounded-full px-4"
                      onClick={() => {
                        if (!activeItem) return
                        updateItem(activeItem.id, (current) => ({ ...current, isPublic: true }))
                      }}
                      disabled={isFieldDisabled}
                    >
                      Public
                    </Button>
                    <Button
                      type="button"
                      variant={!activeItem?.isPublic ? "default" : "outline"}
                      className="rounded-full px-4"
                      onClick={() => {
                        if (!activeItem) return
                        updateItem(activeItem.id, (current) => ({ ...current, isPublic: false }))
                      }}
                      disabled={isFieldDisabled}
                    >
                      Private
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {error && <p className="text-xs text-destructive text-center">{error}</p>}
        </div>
        <DialogFooter className="px-6 py-4 flex items-center justify-between gap-3 border-t border-border shrink-0">
          <Button
            type="button"
            variant="ghost"
            className="rounded-full px-4"
            onClick={handleClose}
            disabled={isUploadingBatch}
          >
            <X className="w-4 h-4 mr-1" />
            Cancel
          </Button>
          <Button
            type="button"
            className="rounded-full px-6"
            onClick={handleUpload}
            disabled={items.length === 0 || isUploadingBatch}
          >
            {isUploadingBatch ? "Uploading..." : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default MediaSelectionModal
