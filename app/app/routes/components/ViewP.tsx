import React, { useEffect, useState } from 'react'
import type { FileType } from '~/lib/types'
import { motion } from 'framer-motion'
import { Badge } from '~/components/ui/badge'
import { EyeOff, ShieldAlert } from 'lucide-react'
import { useSidebar } from '~/components/ui/sidebar'
import HLSPlayer from '~/components/components/hlsplayer'
import ImageLoad from '~/routes/Home/components/ImageLoad/ImageLoad'
import RelatedVideos from '../Dynamic/components/RelatedVideos'
import ImagePreview from '../Dynamic/components/ImagePreview/ImagePreview'
import { ParseFilename, getVideoSrc } from '~/lib/utils'
import { Separator } from '~/components/ui/separator'
import UserAction from './UserAction'

interface ViewPProps {
  file: FileType
}
const ViewP = ({ file }: ViewPProps) => {

    const [poster, setPoster] = useState<string | null>(null);
    
    if(!file) {
      return (
        <>
          <div className={`flex items-center justify-center text-2xl py-6 px-4 min-h-[200px]`}>
            <h1>File not found</h1>
          </div>
        </>
      )
    }
  
    const isHLS = file?.file_type === 'application/vnd.apple.mpegurl' || file?.endpoint?.includes('.m3u8');
  
    const [retryAttempt, setRetryAttempt] = useState<number>(0)
    const [showAdultContent, setShowAdultContent] = useState<boolean>(file?.is_adult ?? false)
    const [imageUrl, setImageUrl] = useState<{ url: string, imageID: string } | null>(null)
    const [imageColors, setImageColors] = useState<string[] | null>(null)
    const [madeImageUrl, setMadeImageUrl] = useState<string | null>(null)
    const {isMobile, state} = useSidebar();
  
    const retry = () => {
      if(retryAttempt >= 1) {
        return
      }
      setRetryAttempt(retryAttempt + 1)
    }
  
    useEffect(() => {
      if (!file?.is_adult) {
        setShowAdultContent(false);
        return;
      }
  
      if (typeof window === "undefined") {
        return;
      }
  
      const hasAccepted = sessionStorage.getItem("adultContentAcknowledged") === "true";
      setShowAdultContent(!hasAccepted);
    }, [file?.is_adult, file?.unique_id]);
  
    const handleRevealAdultContent = () => {
      if (typeof window !== "undefined") {
        const confirmOpen = window.confirm("This content may be unsafe. Do you want to proceed?");
        if (!confirmOpen) {
          return;
        }
        sessionStorage.setItem("adultContentAcknowledged", "true");
      }
  
      setShowAdultContent(false);
    };


  return (
    <>
          <div className="mx-auto py-6">
            <div className="gap-6 flex flex-col">
              <div className="xl:col-span-3 space-y-6">
                <motion.div layoutId={`video_id_${file.unique_id}`} className="relative group flex items-center justify-between min-h-[300px] gap-4 w-full">
                  {/* {imageColors && <GradientColors colors={imageColors} />} */}
                  {file?.is_adult && (
                    <div className="absolute top-3 left-3 z-[100000] pointer-events-none">
                      <Badge className="flex items-center gap-1 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide shadow-lg shadow-black/20 ring-1 ring-primary/40 bg-primary/90 backdrop-blur-sm">
                        <ShieldAlert className="h-3.5 w-3.5" />
                        18+
                      </Badge>
                    </div>
                  )}
      
                  {
                    !showAdultContent ? (
                      <>
                         <div className={`${isHLS ? `aspect-video bg-muted rounded-3xl overflow-hidden shadow-2xl ring-1 ring-border/50 w-full` : `w-fit h-full min-h-[200px] w-full flex items-center justify-center overflow-hidden rounded-4xl ${isMobile || state === 'collapsed' ? `bg-[transparent]` : `bg-[transparent]`}`} min-w-0 h-full relative`}>
                          {isHLS ? (
                            <HLSPlayer
                              src={getVideoSrc(file?.endpoint ?? '', file?.file_type)}
                              className="w-full h-full rounded-3xl"
                              autoPlay={true}
                              muted={false}
                              loop={true}
                              playsInline
                              imageID={file.unique_id}
                              file={file}
                              key={file.unique_id}
                              callBack={e => {
                                setImageColors(e.colors)
                                setMadeImageUrl(e.src)
                              }}
                              videoRef={null as unknown as React.RefObject<HTMLVideoElement>}
                            />
                          ) : (
                              <motion.div 
                              transition={{ duration: 0.1 }} 
                              onClick={e => {
                                if(madeImageUrl) {
                                  setImageUrl({ url: madeImageUrl, imageID: file.unique_id })
                                }
                              }} layoutId={`image_id_${file.unique_id}`} className="w-full h-[500px] max-h-[500px] cursor-zoom-in z-[100]">
                                <ImageLoad
                                  link={`/api/load/image/${file.endpoint}`}
                                  retry={retry}
                                  className="w-full h-full object-contain rounded-3xl"
                                  imageID={file.unique_id}
                                  index={0}
                                  hasAdultTag={false}
                                  callBack={e => {
                                    setMadeImageUrl(e.src)
                                    setImageColors(e.colors)
                                  }}
                                  key={file.unique_id}
                                />
                              </motion.div>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                      <div className="absolute inset-0 backdrop-blur-lg text-center flex flex-col items-center justify-center gap-3 px-4">
                        <EyeOff className="w-10 h-10 text-white" />
                        <span className="text-white text-sm font-medium">Unsafe content</span>
                        <p className="text-white text-xs max-w-xs">This content may not be suitable for all audiences. Please confirm to continue.</p>
                        <button
                          type="button"
                          onClick={handleRevealAdultContent}
                          className="px-4 py-2 text-sm font-medium text-white border border-white/40 rounded-full hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-white transition"
                        >
                          View content
                        </button>
                      </div>
                      </>
                    )
                  }
      
                 
                </motion.div>
                
                <div className="flex items-center justify-between">
                </div>
      
      
                <div className={`${(isMobile || state === 'collapsed' ? `bg-card` : `bg-background`)} rounded-3xl p-8 shadow-lg ring-1 ring-border/50 overflow-x-auto relative w-full`}>
                  <div className="space-y-4 z-[1000]">
                    <div className="flex items-start justify-between">
                      <div className="space-y-2">
                        <h1 className={`text-2xl font-bold break_text text-foreground leading-tight`}>
                          {ParseFilename(file.filename)}    
                        </h1>
                        <div className="flex items-center gap-6 text-sm text-muted-foreground">
                          <span>{new Date(file.created_at).toLocaleDateString('en-US', { 
                            year: 'numeric', 
                            month: 'long', 
                            day: 'numeric' 
                          })}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <Separator />
                  <UserAction />
                </div>
              </div>
      
              {/* <div className="xl:col-span-1">
                <div className={`${(isMobile || state === 'collapsed' ? `bg-card` : `bg-background`)} rounded-3xl shadow-lg ring-1 ring-border/50 overflow-hidden sticky top-6`}>
                  <RelatedVideos data={file} />
                </div> */}
              </div>
            </div>
      
          {/* Image Preview */}
          {imageUrl && (
            <ImagePreview imageUrl={imageUrl} setImageUrl={setImageUrl} />
          )}
    </>
  )
}

export default ViewP