import React, { useEffect, useMemo, useRef, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "~/components/ui/dialog"
import { Button } from "~/components/ui/button"
import { Progress } from "~/components/ui/progress"
import { Input } from "~/components/ui/input"
import { Textarea } from "~/components/ui/textarea"
import { Upload, X, FileImage, FileVideo, Trash2 } from "lucide-react"
import { GenerateUniqueID } from "~/lib/GenerateUniqueID"
import { useFileContext } from "~/lib/Context/Context"
import { useNavigate } from "react-router"

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
  const { userId } = useFileContext()
  const navigate = useNavigate()
  const [items, setItems] = useState<MediaItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isUploadingBatch, setIsUploadingBatch] = useState(false)
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

  const effectiveMaxSize = maxFileSizeBytes ?? 40 * 1024 * 1024

  const resetState = () => {
    items.forEach((item) => {
      URL.revokeObjectURL(item.previewUrl)
    })
    setItems([])
    setActiveId(null)
    setError(null)
    setIsUploadingBatch(false)
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

  const uploadFile = (item: MediaItem) => {
    updateItem(item.id, (current) => ({
      ...current,
      status: "uploading",
      progress: 5,
      statusText: "Preparing upload...",
      error: null,
      jobId: null,
    }))

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

  const pollProcessing = async (jobId: string, itemId: string) => {
    updateItem(itemId, (current) => ({
      ...current,
      status: "processing",
      progress: 100,
      statusText: "Upload queued. Waiting for processing...",
      jobId,
    }))
    let attempts = 0
    const maxAttempts = 120
    while (attempts < maxAttempts) {
      attempts += 1
      const res = await fetch(`/api/upload/status/${jobId}`)
      if (!res.ok) {
        await new Promise((resolve) => setTimeout(resolve, 3000))
        continue
      }
      const json = await res.json()
      if (json.status === "queued" || json.status === "running") {
        updateItem(itemId, (current) => ({
          ...current,
          status: "processing",
          statusText: "Processing video...",
          progress: 100,
        }))
        await new Promise((resolve) => setTimeout(resolve, 3000))
        continue
      }
      if (json.status === "completed") {
        updateItem(itemId, (current) => ({
          ...current,
          status: "success",
          statusText: "Processing complete.",
          progress: 100,
        }))
        return
      }
      if (json.status === "failed") {
        updateItem(itemId, (current) => ({
          ...current,
          status: "error",
          statusText: "Processing failed.",
          error: json.error || "Video processing failed.",
        }))
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }
    updateItem(itemId, (current) => ({
      ...current,
      status: "error",
      statusText: "Processing timed out.",
      error: "Processing timed out.",
    }))
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
        const result = await uploadFile(item)
        const newJobId = result && (result.jobId || result.job_id)
        if (newJobId) {
          await pollProcessing(newJobId, item.id)
        } else {
          updateItem(item.id, (current) => ({
            ...current,
            status: "success",
            statusText: "Upload complete.",
            progress: 100,
          }))
        }
        successfulUploads += 1
        onFilesSelected([item.file])
      } catch {
        updateItem(item.id, (current) => ({
          ...current,
          status: "error",
          statusText: "Upload failed.",
          error: "Failed to upload file. Try again.",
        }))
      }
    }

    setIsUploadingBatch(false)
    const allSucceeded = successfulUploads > 0 && successfulUploads === snapshot.length
    if (allSucceeded) {
      setTimeout(() => {
        resetState()
        onClose()
      }, 2000)
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

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="w-[96vw] max-w-[520px] sm:max-w-xl md:max-w-3xl lg:max-w-4xl xl:max-w-5xl rounded-2xl sm:rounded-3xl p-0 overflow-hidden max-h-[92vh] overflow-y-auto h-[92vh] sm:h-auto">
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle className="text-lg font-semibold text-center">Add Media</DialogTitle>
          <DialogDescription className="text-center text-sm text-muted-foreground">
            Upload images or videos.
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-[220px_1fr]">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-foreground">Selected files</p>
                <span className="text-xs text-muted-foreground">{items.length}</span>
              </div>
              <div className="space-y-2 max-h-[40vh] md:max-h-[380px] overflow-y-auto pr-1">
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
                        <p className="text-[11px] text-muted-foreground">
                          {formatBytes(item.file.size)} · {item.isPublic ? "Public" : "Private"}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
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
                          <span>{item.statusText || item.status}</span>
                          <span>{item.progress}%</span>
                        </div>
                        <Progress value={item.progress} className="h-1.5" />
                      </div>
                    )}
                    {item.error && (
                      <p className="mt-1 text-[11px] text-destructive">{item.error}</p>
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

            <div className="space-y-4">
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
                    <p className="text-xs font-medium text-foreground truncate">{
                      activeItem.file.name.length > 20 ? activeItem.file.name.slice(0, 20) + "..." : activeItem.file.name
                      }</p>
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
                    disabled={!activeItem || isUploadingBatch || activeItem.isLocked}
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
                    rows={3}
                    maxLength={1000}
                    disabled={!activeItem || isUploadingBatch || activeItem.isLocked}
                  />
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
                      disabled={!activeItem || isUploadingBatch || activeItem.isLocked}
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
                      disabled={!activeItem || isUploadingBatch || activeItem.isLocked}
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
        <DialogFooter className="px-6 pb-4 flex items-center justify-between gap-3">
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


