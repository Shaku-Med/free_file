import React, { useState, useRef, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '~/components/ui/dialog'
import { Button } from '~/components/ui/button'
import { Card, CardContent } from '~/components/ui/card'
import { Progress } from '~/components/ui/progress'
import { Upload, X, FileImage, FileVideo, Check, CheckCircle, XCircle, RotateCcw, Loader2 } from 'lucide-react'
import { convertToHLS } from "~/lib/HlsHandler"
import { GenerateUniqueID } from "~/lib/GenerateUniqueID"
import { ThumbnailGenerator } from "./ThumbnailGenerator"

interface MediaSelectionModalProps {
  isOpen: boolean
  onClose: () => void
  onFilesSelected: (files: File[]) => void
}

interface ValidationResult {
  isValid: boolean
  error?: string
}

interface UploadItem {
  id: string
  file: File
  status: 'pending' | 'uploading' | 'success' | 'error'
  progress: number
  error?: string
  retryCount: number
  validationError?: string
  uniqueID: string
  statusText?: string
  nsfwDetected?: boolean
}

const MediaSelectionModal: React.FC<MediaSelectionModalProps> = ({ isOpen, onClose, onFilesSelected }) => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)

  const validateImageFile = async (file: File): Promise<ValidationResult> => {
    return new Promise((resolve) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      
      const cleanup = () => {
        URL.revokeObjectURL(url)
        img.onload = null
        img.onerror = null
      }
      
      img.onload = () => {
        cleanup()
        resolve({ isValid: true })
      }
      
      img.onerror = () => {
        cleanup()
        resolve({ isValid: false, error: 'Invalid or corrupted image file' })
      }
      
      img.src = url
    })
  }

  const validateVideoFile = async (file: File): Promise<ValidationResult> => {
    return new Promise((resolve) => {
      const video = document.createElement('video')
      const url = URL.createObjectURL(file)
      
      const cleanup = () => {
        URL.revokeObjectURL(url)
        video.onloadedmetadata = null
        video.onerror = null
        video.src = ''
      }
      
      video.onloadedmetadata = () => {
        cleanup()
        resolve({ isValid: true })
      }
      
      video.onerror = () => {
        cleanup()
        resolve({ isValid: false, error: 'Invalid or corrupted video file' })
      }
      
      video.src = url
      video.load()
    })
  }

  const validateFileType = (file: File): ValidationResult => {
    if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') {
      return { isValid: true }
    }
    
    if (file.type.startsWith('video/')) {
      return { isValid: true }
    }
    
    if (file.type === 'image/svg+xml') {
      return { isValid: false, error: 'SVG files are not supported. Please use other image formats like JPEG, PNG, GIF, WebP, etc.' }
    }
    
    return { isValid: false, error: `File type '${file.type}' is not supported. Only image and video files are allowed.` }
  }

  const validateFile = async (file: File): Promise<ValidationResult> => {
    const typeValidation = validateFileType(file)
    if (!typeValidation.isValid) {
      return typeValidation
    }
    
    if (file.type.startsWith('image/')) {
      return await validateImageFile(file)
    }
    
    if (file.type.startsWith('video/')) {
      return await validateVideoFile(file)
    }
    
    return { isValid: false, error: 'Unsupported file type' }
  }

  const validateThumbnail = async (thumbnailBlob: Blob): Promise<ValidationResult> => {
    return new Promise((resolve) => {
      const img = new Image()
      const url = URL.createObjectURL(thumbnailBlob)
      
      img.onload = () => {
        URL.revokeObjectURL(url)
        resolve({ isValid: true })
      }
      
      img.onerror = () => {
        URL.revokeObjectURL(url)
        resolve({ isValid: false, error: 'Generated thumbnail is corrupted or invalid' })
      }
      
      img.src = url
    })
  }

  const uploadThumbnail = async (thumbnailBlob: Blob, uniqueID: string, videoFilename: string): Promise<boolean> => {
    try {
      const thumbnailValidation = await validateThumbnail(thumbnailBlob)
      if (!thumbnailValidation.isValid) {
        return false
      }
      
      const formData = new FormData()
      formData.append('file', thumbnailBlob)
      formData.append('name', `thumbnail_${videoFilename.replace(/\.[^/.]+$/, '.jpg')}`)
      formData.append('uniqueID', uniqueID)

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })
      
      if (!response.ok) {
        return false
      }

      return true
    } catch (error) {
      return false
    }
  }

  const VideoFetchPush = async (segmentUrls: { blob: Blob, name: string }[], uniqueID: string, isAdult?: boolean): Promise<boolean> => {
    try {
      for (let i = 0; i < segmentUrls.length; i++) {
        const segment = segmentUrls[i]
        
        const formData = new FormData()
        formData.append('file', segment.blob)
        formData.append('name', segment.name)
        formData.append('uniqueID', uniqueID)
        
        // Only send is_adult for m3u8 files (main video file)
        if (segment.name.endsWith('.m3u8') && isAdult !== undefined) {
          formData.append('is_adult', isAdult.toString())
        }

        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        })
        
        if (!response.ok) {
          return false
        }
      }
      
      return true
    } catch (error) {
      return false
    }
  }

  const uploadVideo = async (
    file: File, 
    index: number, 
    onProgress: (value: number, statusText?: string) => void, 
    uniqueID: string,
    onStatusUpdate?: (statusText: string, nsfwDetected?: boolean) => void
  ): Promise<boolean> => {
    let thumbnailGenerator: ThumbnailGenerator | null = null
    
    try {
      thumbnailGenerator = new ThumbnailGenerator()

      onStatusUpdate?.('Processing your video checking for adult contents...', false)
      
      const thumbnailResult = await thumbnailGenerator.generateThumbnail(file, {
        maxWidth: 1920,
        maxHeight: 1080,
        maintainAspectRatio: true,
        onProgress: (progress, message) => {
          const progressPercent = Math.max(1, Math.min(progress, 100))
          onProgress(progressPercent, `Processing your video checking for adult contents... checks ${progressPercent}%`)
        }
      })

      let isAdult = false
      
      if (thumbnailResult.success && thumbnailResult.thumbnailBlob) {
        if (thumbnailResult.nsfw !== undefined && thumbnailResult.nsfw) {
          isAdult = true
          onStatusUpdate?.('Adult content detected in the video', true)
          // Wait a moment to show the message
          await new Promise(resolve => setTimeout(resolve, 1500))
        } else {
          onStatusUpdate?.('Content check complete', false)
        }

        const thumbnailUploaded = await uploadThumbnail(thumbnailResult.thumbnailBlob, uniqueID, file.name)
      }

      await thumbnailGenerator.destroy()
      thumbnailGenerator = null

      onStatusUpdate?.('Converting video...', false)
      const { m3u8Url, segmentUrls } = await convertToHLS(file, (ratio: number) => {
        const value = Math.max(10, Math.min(90, Math.round(10 + (ratio * 80))))
        onProgress(value, 'Converting video...')
      })
      if (!m3u8Url || segmentUrls.length === 0) {
        return false
      }

      onStatusUpdate?.('Uploading video...', false)
      const uploadSuccess = await VideoFetchPush(segmentUrls, uniqueID, isAdult)

      // Free the Object URL to prevent memory leaks after upload
      try { URL.revokeObjectURL(m3u8Url) } catch {}
      if (!uploadSuccess) {
        return false
      }

      onProgress(100, 'Upload complete')
      return true
    } catch (error) {
      return false
    } finally {
      if (thumbnailGenerator) {
        try {
          await thumbnailGenerator.destroy()
        } catch (error) {
          // Silent cleanup
        }
      }
    }
  }

  const uploadFile = async (
    file: File, 
    index: number, 
    onProgress: (value: number, statusText?: string) => void, 
    uniqueID: string,
    onStatusUpdate?: (statusText: string, nsfwDetected?: boolean) => void
  ): Promise<boolean> => {
    try {
      if(file.type.startsWith(`video/`)) {
        return uploadVideo(file, index, onProgress, uniqueID, onStatusUpdate)
      }
      
      if(file.type.startsWith(`image/`)) {
        const thumbnailGenerator = new ThumbnailGenerator()
        
        try {
          onStatusUpdate?.('Processing your image checking for adult contents...', false)
          
          const nsfwResult = await thumbnailGenerator.checkImageNSFW(file, (progress, message) => {
            const progressPercent = Math.max(1, Math.min(progress, 100))
            onProgress(progressPercent, `Processing your image checking for adult contents... checks ${progressPercent}%`)
          })
          
          let isAdult = false
          
          if (nsfwResult.success) {
            if (nsfwResult.nsfw) {
              isAdult = true
              onStatusUpdate?.('Adult content detected in the image', true)
              await new Promise(resolve => setTimeout(resolve, 1500))
            } else {
              onStatusUpdate?.('Content check complete', false)
            }
          }
          
          await thumbnailGenerator.destroy()
          
          onStatusUpdate?.('Uploading image...', false)
          const formData = new FormData()
          formData.append('file', file)
          formData.append('name', file.name)
          formData.append('uniqueID', uniqueID)
          formData.append('is_adult', isAdult.toString())

          const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData,
          })
          
          if (!response.ok) {
            throw new Error(`Upload failed: ${response.statusText}`)
          }

          const result = await response.json()
          if (result.success) {
            onProgress(100, 'Upload complete')
          }
          return result.success
          
          onProgress(100, 'Upload complete')
          return true
        } finally {
          try {
            await thumbnailGenerator.destroy()
          } catch (error) {
            // Silent cleanup
          }
        }
      }
      
      return true
    } catch (error) {
      return false
    }
  }

  const processUploadQueue = useCallback(async () => {
    if (isUploading || uploadQueue.length === 0) return
    
    setIsUploading(true)
    const pendingItems = uploadQueue.filter(item => item.status === 'pending')
    
    const timeoutId = setTimeout(() => {
      setIsUploading(false)
    }, 300000) // 5 minute timeout
    
    try {
      for (let i = 0; i < pendingItems.length; i++) {
        const item = pendingItems[i]
        const itemIndex = uploadQueue.findIndex(uploadItem => uploadItem.id === item.id)
        
        setUploadQueue(prev => prev.map(uploadItem => 
          uploadItem.id === item.id 
            ? { ...uploadItem, status: 'uploading', progress: 0, statusText: 'Starting...' }
            : uploadItem
        ))

        const success = await uploadFile(
          item.file, 
          i, 
          (value: number, statusText?: string) => {
            setUploadQueue(prev => prev.map(uploadItem => 
              uploadItem.id === item.id 
                ? { ...uploadItem, progress: value, status: 'uploading', statusText: statusText || uploadItem.statusText }
                : uploadItem
            ))
          }, 
          item.uniqueID,
          (statusText: string, nsfwDetected?: boolean) => {
            setUploadQueue(prev => prev.map(uploadItem => 
              uploadItem.id === item.id 
                ? { ...uploadItem, statusText, nsfwDetected: nsfwDetected || false }
                : uploadItem
            ))
          }
        )

        setUploadQueue(prev => prev.map(uploadItem => 
          uploadItem.id === item.id 
            ? { 
                ...uploadItem, 
                status: success ? 'success' : 'error',
                progress: success ? 100 : uploadItem.progress,
                error: success ? undefined : 'Failed to upload file'
              }
            : uploadItem
        ))
      }
    } finally {
      clearTimeout(timeoutId)
      setIsUploading(false)
    }
  }, [isUploading, uploadQueue])

  const retryItem = (id: string) => {
    setUploadQueue(prev => prev.map(uploadItem => 
      uploadItem.id === id 
        ? { ...uploadItem, status: 'pending', progress: 0, error: undefined }
        : uploadItem
    ))
  }

  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files) return

    const fileArray = Array.from(files)
    const validFiles: File[] = []
    const invalidFiles: { file: File, error: string }[] = []
    
    for (const file of fileArray) {
      const validation = await validateFile(file)
      if (validation.isValid) {
        validFiles.push(file)
      } else {
        invalidFiles.push({ file, error: validation.error || 'Unknown validation error' })
      }
    }
    
    if (invalidFiles.length > 0) {
      alert(`The following files were rejected:\n${invalidFiles.map(f => `• ${f.file.name}: ${f.error}`).join('\n')}`)
    }
    
    if (validFiles.length > 0) {
      const newUploadItems: UploadItem[] = validFiles.map(file => ({
        id: Math.random().toString(36).substr(2, 9),
        file,
        status: 'pending' as const,
        progress: 0,
        retryCount: 0,
        uniqueID: GenerateUniqueID()
      }))
      
      setUploadQueue(prev => [...prev, ...newUploadItems])
    }
    
    setSelectedFiles([])
  }, [])

  React.useEffect(() => {
    if (uploadQueue.length > 0 && !isUploading) {
      processUploadQueue()
    }
  }, [uploadQueue, isUploading])

  React.useEffect(() => {
    return () => {
      // Cleanup on unmount
    }
  }, [])

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    handleFileSelect(e.dataTransfer.files)
  }

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index))
  }

  const handleClose = () => {
    if (uploadQueue.length === 0 || uploadQueue.every(item => item.status === 'success' || item.status === 'error')) {
      onFilesSelected([])
      setUploadQueue([])
      setSelectedFiles([])
      onClose()
    }
  }

  const getStatusIcon = (status: UploadItem['status']) => {
    switch (status) {
      case 'pending':
        return <Upload className="w-4 h-4 text-muted-foreground" />
      case 'uploading':
        return <Loader2 className="w-4 h-4 text-primary animate-spin" />
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'error':
        return <XCircle className="w-4 h-4 text-destructive" />
    }
  }

  const getStatusColor = (status: UploadItem['status']) => {
    switch (status) {
      case 'pending':
        return 'text-muted-foreground'
      case 'uploading':
        return 'text-primary'
      case 'success':
        return 'text-green-500'
      case 'error':
        return 'text-destructive'
    }
  }

  const getFileIcon = (file: File) => {
    if (file.type.startsWith('image/')) return <FileImage className="w-5 h-5" />
    if (file.type.startsWith('video/')) return <FileVideo className="w-5 h-5" />
    return <FileImage className="w-5 h-5" />
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-hidden flex flex-col bg-background/95 backdrop-blur-xl border-0 shadow-2xl">
        <DialogHeader className="pb-4">
          <DialogTitle className="text-xl font-semibold text-center">
            {uploadQueue.length > 0 ? 'Processing Files' : 'Add Media'}
          </DialogTitle>
          <DialogDescription className="text-center text-sm text-muted-foreground">
            {uploadQueue.length > 0 
              ? 'Files are being processed automatically' 
              : 'Choose any image or video files'
            }
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-1">
          {uploadQueue.length === 0 ? (
            <div
              className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all duration-200 ${
                dragActive 
                  ? 'border-primary bg-primary/10 scale-[1.02]' 
                  : 'border-muted-foreground/20 hover:border-muted-foreground/40 hover:bg-muted/30'
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
                <Upload className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-lg font-medium mb-2">Drop files here</h3>
              <p className="text-sm text-muted-foreground mb-6">
                or tap to browse
              </p>
              <Button
                variant="default"
                onClick={async () => {
                  const input = document.createElement('input')
                  input.type = 'file'
                  input.multiple = true
                  input.accept = 'image/*,video/*'
                  input.onchange = async (e) => {
                    const target = e.target as HTMLInputElement
                    await handleFileSelect(target.files)
                    if (document.body.contains(input)) {
                      document.body.removeChild(input)
                    }
                  }
                  document.body.appendChild(input)
                  input.click()
                }}
                className="rounded-full px-8 py-2 font-medium shadow-lg"
              >
                Choose Files
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-semibold text-base">Processing ({uploadQueue.length})</h4>
                <div className="text-sm text-muted-foreground">
                  {uploadQueue.filter(item => item.status === 'success').length} completed
                </div>
              </div>
              <div className="bg-card/50 rounded-2xl overflow-hidden border border-border/20 ios-shadow max-h-64 overflow-y-auto">
                {uploadQueue.map((item, index) => (
                  <div 
                    key={item.id} 
                    className={`flex items-center justify-between px-4 py-3.5 text-sm font-medium transition-colors ${
                      index !== uploadQueue.length - 1 ? 'border-b border-border/20' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {getStatusIcon(item.status)}
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        {getFileIcon(item.file)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{item.file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatFileSize(item.file.size)}
                        </p>
                        {item.status === 'uploading' && (
                          <>
                            <Progress value={item.progress} className="mt-1 h-1" />
                            {item.statusText && (
                              <p className={`text-xs mt-1 ${item.nsfwDetected ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                                {item.statusText}
                              </p>
                            )}
                          </>
                        )}
                        {item.validationError && (
                          <p className="text-xs text-destructive mt-1">{item.validationError}</p>
                        )}
                        {item.status === 'error' && item.error && (
                          <p className="text-xs text-destructive mt-1">{item.error}</p>
                        )}
                      </div>
                    </div>
                    {item.status === 'error' && (
                      <div className="ml-3 flex-shrink-0">
                        <Button variant="outline" onClick={() => retryItem(item.id)} className="h-8 px-3 rounded-full">
                          Retry
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="pt-6 pb-2 px-1">
          <div className="flex gap-3 w-full">
            {uploadQueue.length === 0 ? (
              <>
                <Button 
                  variant="outline" 
                  onClick={handleClose}
                  className="flex-1 rounded-full py-3 font-medium"
                >
                  Cancel
                </Button>
                <Button 
                  onClick={async () => {
                    const input = document.createElement('input')
                    input.type = 'file'
                    input.multiple = true
                    input.accept = 'image/*,video/*'
                    input.onchange = async (e) => {
                      const target = e.target as HTMLInputElement
                      await handleFileSelect(target.files)
                      if (document.body.contains(input)) {
                        document.body.removeChild(input)
                      }
                    }
                    document.body.appendChild(input)
                    input.click()
                  }} 
                  className="flex-1 rounded-full py-3 font-medium shadow-lg"
                >
                  Choose Files
                </Button>
              </>
            ) : (
              <Button 
                onClick={handleClose}
                disabled={uploadQueue.some(item => item.status === 'uploading')}
                className="w-full rounded-full py-3 font-medium"
              >
                {uploadQueue.some(item => item.status === 'uploading') 
                  ? 'Processing...' 
                  : uploadQueue.every(item => item.status === 'success') 
                    ? 'Done' 
                    : 'Close'
                }
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default MediaSelectionModal