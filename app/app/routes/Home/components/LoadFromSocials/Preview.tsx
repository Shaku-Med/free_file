import React, { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Button } from '~/components/ui/button'
import { Card, CardContent } from '~/components/ui/card'
import { Download, Maximize2, X, FileImage, FileVideo } from 'lucide-react'

interface PreviewProps {
  previewUrl: string
  blob: Blob
  fileName: string
  onClose: () => void
  onUse: () => void
}

const Preview: React.FC<PreviewProps> = ({ previewUrl, blob, fileName, onClose, onUse }) => {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const isImage = blob.type.startsWith('image/')
  const isVideo = blob.type.startsWith('video/')

  const handleDownload = () => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName || 'download'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <>
      <Card className="w-full border-border/50 overflow-hidden">
        <CardContent className="p-0">
          <div className="relative group">
            {isImage ? (
              <div className="relative w-full aspect-video bg-muted/30 flex items-center justify-center overflow-hidden rounded-t-lg">
                <img 
                  src={previewUrl} 
                  alt="Preview" 
                  className="w-full h-full object-contain"
                />
              </div>
            ) : isVideo ? (
              <div className="relative w-full aspect-video bg-black rounded-t-lg overflow-hidden">
                <video 
                  src={previewUrl} 
                  controls 
                  className="w-full h-full object-contain"
                />
              </div>
            ) : null}
            
            <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="secondary"
                size="icon"
                onClick={() => setIsDialogOpen(true)}
                className="h-8 w-8 rounded-full bg-background/90 backdrop-blur-sm hover:bg-background shadow-lg"
              >
                <Maximize2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
          
          <div className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  {isImage ? (
                    <FileImage className="w-4 h-4 text-primary" />
                  ) : isVideo ? (
                    <FileVideo className="w-4 h-4 text-primary" />
                  ) : null}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{fileName || 'Preview'}</p>
                  <p className="text-xs text-muted-foreground">{formatFileSize(blob.size)}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="h-8 w-8 rounded-full flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setIsDialogOpen(true)}
                className="flex-1 rounded-full"
              >
                <Maximize2 className="w-4 h-4 mr-2" />
                Open
              </Button>
              <Button
                variant="outline"
                onClick={handleDownload}
                className="flex-1 rounded-full"
              >
                <Download className="w-4 h-4 mr-2" />
                Download
              </Button>
              <Button
                onClick={onUse}
                className="flex-1 rounded-full shadow-lg"
              >
                Use This
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] p-0 bg-background/95 backdrop-blur-xl border-0 shadow-2xl">
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle className="text-lg font-semibold">{fileName || 'Preview'}</DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6 overflow-auto max-h-[calc(90vh-120px)]">
            {isImage ? (
              <div className="w-full flex items-center justify-center bg-muted/20 rounded-lg overflow-hidden">
                <img 
                  src={previewUrl} 
                  alt="Preview" 
                  className="max-w-full max-h-[70vh] object-contain"
                />
              </div>
            ) : isVideo ? (
              <div className="w-full bg-black rounded-lg overflow-hidden">
                <video 
                  src={previewUrl} 
                  controls 
                  className="w-full max-h-[70vh]"
                  autoPlay
                />
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default Preview

