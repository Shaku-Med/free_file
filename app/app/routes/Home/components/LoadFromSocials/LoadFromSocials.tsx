import { Info, Instagram, Link2, Download, Loader2 } from 'lucide-react'
import React, { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Button } from '~/components/ui/button'
import { SOCIAL_URL, BASE_URL } from '~/lib/URLS'

interface LoadFromSocialsProps {
    onDownloadCallback: (data: { blob: Blob; info: any }) => void
}
interface InfoArrayProps {
    title: string
    description: string
    icon: React.ReactNode
}

export const InfoArray: InfoArrayProps[] = [
    {
        title: `Download from Social Media`,
        description: `You can download images and videos from social media platforms like Instagram, Facebook, YouTube, etc. Just enter the social media platform URL and click on the download button.`,
        icon: <Instagram className="w-5 h-5" />
    },
    {
        title: `Download from Direct URLs`,
        description: `You can also download from an image or video file online. Just enter the image or video file URL and click on the download button.`,
        icon: <Link2 className="w-5 h-5" />
    }
]

export const isValidMediaType = (blob: Blob): boolean => {
    const type = blob.type
    if (!type) return false
    
    return type.startsWith('image/') || type.startsWith('video/')
}


const LoadFromSocials: React.FC<LoadFromSocialsProps> = ({ onDownloadCallback }) => {
  const [url, setUrl] = useState('')
  const [isDownloading, setIsDownloading] = useState(false)

  const isValidUrl = (urlString: string): boolean => {
    if (!urlString.trim()) return false
    
    const trimmedUrl = urlString.trim()
    
    if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
      return false
    }
    
    if (trimmedUrl.match(/https?:\/\/\/+/)) {
      return false
    }
    
    try {
      const url = new URL(trimmedUrl)
      
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return false
      }
      
      if (!url.hostname || url.hostname.length === 0) {
        return false
      }
      
      if (url.hostname.length < 3) {
        return false
      }
      
      if (!url.hostname.includes('.') && url.hostname !== 'localhost') {
        return false
      }
      
      if (url.hostname.startsWith('.') || url.hostname.endsWith('.')) {
        return false
      }
      
      if (url.hostname.includes('..')) {
        return false
      }
      
      return true
    } catch {
      return false
    }
  }

  const handleDownload = async () => {
    if (isDownloading) return
    
    setIsDownloading(true)
    try {
      const encodedUrl = encodeURIComponent(url)
      const infoResponse = await fetch(`${BASE_URL}/api/socials/info/${encodedUrl}`)
      let info: any = null
      
      if (infoResponse.ok) {
        try {
          info = await infoResponse.json()
        } catch (e) {
          console.warn('Failed to parse info response:', e)
        }
      } else {
        console.warn('Failed to fetch info:', infoResponse.status, infoResponse.statusText)
      }

      const response = await fetch(`${SOCIAL_URL}${url}`)
      if (!response.ok) {
        alert(`We can't download this file from ${url}`)
        setIsDownloading(false)
        return
      }

      let blob = await response.blob()
      
      if (!isValidMediaType(blob)) {
        alert(`The downloaded file is not an image or video. File type: ${blob.type || 'unknown'}`)
        setIsDownloading(false)
        return
      }
      
      console.log(URL.createObjectURL(blob))
      onDownloadCallback?.({ blob, info })
      setIsDownloading(false)
      return;
    } catch (error) {
      console.error('Error downloading from social media:', error)
      setIsDownloading(false)
    }
  }

  const isUrlValid = isValidUrl(url)

  return (
    <div className="space-y-4 mb-6">
        <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Upload from Socials</h2>
            <Dialog>
                <DialogTrigger asChild>
                    <Button 
                        variant="ghost" 
                        size="icon"
                        className="h-8 w-8 rounded-full hover:bg-primary/10"
                    >
                        <Info className="w-4 h-4 text-muted-foreground" />
                        <span className="sr-only">Information</span>
                    </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-semibold">
                            How to Upload from Socials
                        </DialogTitle>
                        <DialogDescription className="sr-only">How to upload from socials</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 mt-4">
                       {InfoArray.map((item, index) => (
                        <div 
                            key={index}
                            className="flex gap-3 p-4 rounded-xl bg-muted/50 border border-border/50"
                        >
                            <div className="flex-shrink-0 mt-0.5">
                                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                                    {item.icon}
                                </div>
                            </div>
                            <div className="flex-1 space-y-1">
                                <h3 className="font-medium text-sm">{item.title}</h3>
                                <p className="text-sm text-muted-foreground leading-relaxed">
                                    {item.description}
                                </p>
                            </div>
                        </div>
                       ))}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
       <div className="space-y-2">
          <div className="flex gap-2">
            <Input 
              type="text" 
              placeholder="Enter Social URL (e.g., Instagram, Facebook, YouTube...)" 
              className="w-full rounded-xl border-border/50 focus:border-primary"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isDownloading}
            />
            {isUrlValid && (
              <Button
                onClick={handleDownload}
                disabled={isDownloading}
                className="rounded-xl px-6 font-medium shadow-lg whitespace-nowrap"
              >
                {isDownloading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Downloading...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </>
                )}
              </Button>
            )}
          </div>
       </div>
    </div>
  )
}

export default LoadFromSocials