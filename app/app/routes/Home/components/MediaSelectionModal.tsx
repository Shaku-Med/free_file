import React, { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "~/components/ui/dialog"
import { Button } from "~/components/ui/button"
import { Progress } from "~/components/ui/progress"
import { Input } from "~/components/ui/input"
import { Textarea } from "~/components/ui/textarea"
import { Upload, X, FileImage, FileVideo } from "lucide-react"
import { GenerateUniqueID } from "~/lib/GenerateUniqueID"
import { useFileContext } from "~/lib/Context/Context"
import { useNavigate } from "react-router"

interface MediaSelectionModalProps {
  isOpen: boolean
  onClose: () => void
  onFilesSelected: (files: File[]) => void
  maxFileSizeBytes?: number
}

type UploadStatus = "idle" | "uploading" | "success" | "error"

export const MediaSelectionModal: React.FC<MediaSelectionModalProps> = ({
  isOpen,
  onClose,
  onFilesSelected,
  maxFileSizeBytes,
}) => {
  const { userId } = useFileContext()
  const navigate = useNavigate()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<UploadStatus>("idle")
  const [progress, setProgress] = useState(0)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen && !userId) {
      onClose()
      navigate('/auth/login')
    }
  }, [isOpen, userId, onClose, navigate])

  useEffect(() => {
    if (selectedFile && isOpen) {
      if (!previewUrl) {
        const url = URL.createObjectURL(selectedFile)
        setPreviewUrl(url)
      }
    }
    if (!selectedFile && previewUrl) {
      URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
    }
  }, [selectedFile, isOpen])

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

  const effectiveMaxSize = maxFileSizeBytes ?? 40 * 1024 * 1024

  const resetState = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }
    setSelectedFile(null)
    setPreviewUrl(null)
    setError(null)
    setStatus("idle")
    setProgress(0)
    setStatusText(null)
    setJobId(null)
    setTitle("")
    setDescription("")
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

  const handleFileChange = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) {
      return
    }
    const file = fileList[0]
    const validationError = validateFile(file)
    if (validationError) {
      setSelectedFile(null)
      setError(validationError)
      return
    }
    setSelectedFile(file)
    setError(null)
    setStatus("idle")
    setProgress(0)
    setStatusText(null)
    const baseName = file.name.replace(/\.[^./\\]+$/, "")
    if (!title) {
      setTitle(baseName.slice(0, 200))
    }
  }

  const handleUpload = async () => {
    if (!selectedFile) {
      setError("Select a file to upload.")
      return
    }
    const validationError = validateFile(selectedFile)
    if (validationError) {
      setError(validationError)
      return
    }
    try {
      setStatus("uploading")
      setProgress(5)
      setStatusText("Preparing upload...")

      const uniqueID = GenerateUniqueID()
      const formData = new FormData()
      formData.append("file", selectedFile)
      formData.append("name", selectedFile.name)
      formData.append("uniqueID", uniqueID)
      if (title.trim().length > 0) {
        formData.append("title", title.trim())
      }
      if (description.trim().length > 0) {
        formData.append("description", description.trim())
      }

      const xhr = new XMLHttpRequest()
      xhr.open("POST", "/api/upload", true)

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return
        const percent = Math.min(95, Math.max(10, Math.round((event.loaded / event.total) * 100)))
        setProgress(percent)
        setStatusText("Uploading...")
      }

      const uploadPromise = new Promise<any>((resolve, reject) => {
        xhr.onreadystatechange = () => {
          if (xhr.readyState === XMLHttpRequest.DONE) {
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
        }
        xhr.onerror = () => reject(new Error("Upload failed"))
      })

      xhr.send(formData)
      const result = await uploadPromise
      const newJobId = result && (result.jobId || result.job_id)

      console.log(result)
      setProgress(100)
      setJobId(newJobId || null)
      if (newJobId) {
        setStatusText("Upload queued. Waiting for processing...")
        try {
          let attempts = 0
          const maxAttempts = 120
          while (attempts < maxAttempts) {
            attempts += 1
            const res = await fetch(`/api/upload/status/${newJobId}`)
            if (!res.ok) {
              await new Promise((resolve) => setTimeout(resolve, 3000))
              continue
            }
            const json = await res.json()
            if (json.status === "queued" || json.status === "running") {
              setStatus("uploading")
              setStatusText("Processing video...")
              await new Promise((resolve) => setTimeout(resolve, 3000))
              continue
            }
            if (json.status === "completed") {
              setStatus("success")
              setStatusText("Processing complete.")
              setTimeout(() => {
                resetState()
                onClose()
              }, 2000)
              break
            }
            if (json.status === "failed") {
              setStatus("error")
              setStatusText("Processing failed.")
              setError(json.error || "Video processing failed.")
              break
            }
            await new Promise((resolve) => setTimeout(resolve, 3000))
          }
        } catch {
          setStatus("error")
          setStatusText("Processing failed.")
        }
      } else {
        setStatus("success")
        setStatusText("Upload complete.")
        setTimeout(() => {
          resetState()
          onClose()
        }, 2000)
      }
      onFilesSelected([selectedFile])
    } catch (e) {
      setStatus("error")
      setStatusText("Upload failed.")
      setError("Failed to upload file. Try again.")
    }
  }

  const handleClose = () => {
    if (status === "uploading") {
      return
    }
    setError(null)
    setStatus("idle")
    setProgress(0)
    setStatusText(null)
    setJobId(null)
    onClose()
  }

  const renderFileIcon = () => {
    if (!selectedFile) return <Upload className="w-8 h-8 text-primary" />
    if (selectedFile.type.startsWith("image/")) return <FileImage className="w-8 h-8 text-primary" />
    if (selectedFile.type.startsWith("video/")) return <FileVideo className="w-8 h-8 text-primary" />
    return <Upload className="w-8 h-8 text-primary" />
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className=" w-full rounded-2xl p-0 overflow-hidden md:min-w-2xl max-w-lg">
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle className="text-lg font-semibold text-center">Add Media</DialogTitle>
          <DialogDescription className="text-center text-sm text-muted-foreground">
            Upload up to {formatBytes(effectiveMaxSize)} of media.
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-4 space-y-4">
          {previewUrl && selectedFile ? (
            <div className="border border-border rounded-2xl overflow-hidden bg-muted/50">
              {selectedFile.type.startsWith("image/") ? (
                <div className="relative w-full aspect-video bg-muted flex items-center justify-center">
                  <img
                    src={previewUrl}
                    alt="Preview"
                    className="w-full h-full object-contain"
                  />
                </div>
              ) : selectedFile.type.startsWith("video/") ? (
                <div className="relative w-full aspect-video bg-black">
                  <video
                    src={previewUrl}
                    controls
                    className="w-full h-full object-contain"
                    preload="metadata"
                  />
                </div>
              ) : null}
              <div className="p-3 border-t border-border">
                <p className="text-xs font-medium text-foreground truncate">{
                  selectedFile.name.length > 20 ? selectedFile.name.slice(0, 20) + "..." : selectedFile.name
                  }</p>
                <p className="text-xs text-muted-foreground">{formatBytes(selectedFile.size)}</p>
              </div>
            </div>
          ) : (
            <div className="border border-dashed rounded-2xl p-6 text-center cursor-pointer hover:border-primary/60 transition-colors">
              <div className="flex items-center justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                  {renderFileIcon()}
                </div>
              </div>
              <p className="text-sm font-medium mb-1">
                Choose an image or video file
              </p>
              <p className="text-xs text-muted-foreground mb-4">
                Max size {formatBytes(effectiveMaxSize)}. Allowed types: image/*, video/*.
              </p>
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            className="w-full rounded-full"
            onClick={() => {
              const input = document.createElement("input")
              input.type = "file"
              input.accept = "image/*,video/*"
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
          >
            {selectedFile ? "Change file" : "Browse files"}
          </Button>
          <div className="space-y-3 text-left">
            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground">Title</p>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter a title for this file"
                maxLength={200}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground">Description</p>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe this file"
                rows={3}
                maxLength={1000}
              />
            </div>
          </div>
          {error && <p className="text-xs text-destructive text-center">{error}</p>}
          {status === "success" && (
            <div className="rounded-lg bg-primary/10 border border-primary/20 p-4 text-center">
              <p className="text-sm font-medium text-primary mb-1">Upload Successful!</p>
              <p className="text-xs text-muted-foreground">Your upload will appear here soon.</p>
            </div>
          )}
          {status !== "idle" && status !== "success" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{statusText}</span>
                <span className="text-muted-foreground">{progress}%</span>
              </div>
              <Progress value={progress} className="h-1.5" />
            </div>
          )}
        </div>
        <DialogFooter className="px-6 pb-4 flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            className="rounded-full px-4"
            onClick={handleClose}
            disabled={status === "uploading"}
          >
            <X className="w-4 h-4 mr-1" />
            Cancel
          </Button>
          <Button
            type="button"
            className="rounded-full px-6"
            onClick={handleUpload}
            disabled={!selectedFile || status === "uploading"}
          >
            {status === "uploading" ? "Uploading..." : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default MediaSelectionModal


