import React, { useState, useRef, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '~/components/ui/dialog'
import { Button } from '~/components/ui/button'
import { Card, CardContent } from '~/components/ui/card'
import { Upload, X, FileImage, FileAudio, FileVideo, Check } from 'lucide-react'

interface MediaSelectionModalProps {
  isOpen: boolean
  onClose: () => void
  onFilesSelected: (files: File[]) => void
}

const MediaSelectionModal: React.FC<MediaSelectionModalProps> = ({ isOpen, onClose, onFilesSelected }) => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const validateFile = (file: File): boolean => {
    return file.type.startsWith('image/') || 
           file.type.startsWith('audio/') || 
           file.type.startsWith('video/')
  }

  const handleFileSelect = useCallback((files: FileList | null) => {
    if (!files) return

    const validFiles = Array.from(files).filter(validateFile)
    setSelectedFiles(prev => [...prev, ...validFiles])
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileSelect(e.target.files)
  }

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

  const handleConfirm = () => {
    onFilesSelected(selectedFiles)
    setSelectedFiles([])
    onClose()
  }

  const handleCancel = () => {
    setSelectedFiles([])
    onClose()
  }

  const getFileIcon = (file: File) => {
    if (file.type.startsWith('image/')) return <FileImage className="w-5 h-5" />
    if (file.type.startsWith('audio/')) return <FileAudio className="w-5 h-5" />
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
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-hidden flex flex-col bg-background/95 backdrop-blur-xl border-0 shadow-2xl">
        <DialogHeader className="pb-4">
          <DialogTitle className="text-xl font-semibold text-center">Add Media</DialogTitle>
          <DialogDescription className="text-center text-sm text-muted-foreground">
            Choose photos, videos, or audio files
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-1">
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
              onClick={() => fileInputRef.current?.click()}
              className="rounded-full px-8 py-2 font-medium shadow-lg"
            >
              Choose Files
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,audio/*,video/*"
              onChange={handleInputChange}
              className="hidden"
            />
          </div>

          {selectedFiles.length > 0 && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-semibold text-base">Selected ({selectedFiles.length})</h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedFiles([])}
                  className="text-muted-foreground hover:text-foreground rounded-xl ios-scale"
                >
                  Clear All
                </Button>
              </div>
              <div className="bg-card/50 rounded-2xl overflow-hidden border border-border/20 ios-shadow max-h-64 overflow-y-auto">
                {selectedFiles.map((file, index) => (
                  <div 
                    key={index} 
                    className={`flex items-center justify-between px-4 py-3.5 text-sm font-medium active:bg-primary/10 transition-colors ios-scale ${
                      index !== selectedFiles.length - 1 ? 'border-b border-border/20' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        {getFileIcon(file)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatFileSize(file.size)}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeFile(index)}
                      className="h-8 w-8 rounded-xl hover:bg-destructive/10 hover:text-destructive ios-scale"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="pt-6 pb-2 px-1">
          <div className="flex gap-3 w-full">
            <Button 
              variant="outline" 
              onClick={handleCancel}
              className="flex-1 rounded-full py-3 font-medium"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleConfirm} 
              disabled={selectedFiles.length === 0}
              className="flex-1 rounded-full py-3 font-medium shadow-lg"
            >
              Add {selectedFiles.length} File{selectedFiles.length !== 1 ? 's' : ''}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default MediaSelectionModal