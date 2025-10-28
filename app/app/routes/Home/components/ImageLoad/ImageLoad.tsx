import React, { useLayoutEffect, useState } from 'react'
import type { FileType } from '~/lib/types'
import { cn } from '~/lib/utils'
import { Loader2 } from 'lucide-react'
interface ImageLoadProps {
    setError: (error: boolean) => void
    link?: string
    className?: string
    imageID?: string
    index?: number
}
const ImageLoad = ({setError, link, className, imageID, index }: ImageLoadProps) => {
    const [src, setSrc] = useState<string | null | boolean>(null)

    useLayoutEffect(() => {
        let fetchImage = async () => {
            if(!link) return
            
            if(imageID && (window as any)[`_${imageID}`]) {
                setSrc((window as any)[`_${imageID}`].imageUrl)
                return
            }

            await new Promise(resolve => setTimeout(resolve, 200 * (index || 0)))
            
            let response = await fetch(link)
            if(!response.ok) {
                setError(true)
                return
            }
            let blob = await response.blob()
            let blobURL = URL.createObjectURL(blob)
            
            if(imageID) {
                const currentCache = (window as any)[`_${imageID}`] || {};
                (window as any)[`_${imageID}`] = {
                    ...currentCache,
                    imageUrl: blobURL
                }
            }
            
            let image = new Image()
            image.src = blobURL
            image.onload = () => {
                setSrc(image.src)
            }
            image.onerror = () => {
                setError(true)
            }
        }
        if(link) {
            fetchImage()
        }
    }, [link, imageID, index])

    return (
        <>
            {
                src ? (
                    <>
                      <img
                            src={`${src}`}
                            alt={`Thumbnail`}
                            className={cn("w-full h-full object-cover", className)}
                            onError={() => {
                                setError(true)
                            }}
                            loading="lazy"
                        />
                    </>
                ) : src === null ? (
                    <div className={cn("w-full h-full flex flex-col items-center justify-center bg-muted text-xs", className)}>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Loading...</span>
                    </div>
                ) : (
                    <div className={cn("w-full h-full flex items-center justify-center bg-muted text-xs", className)}>
                        <span>Failed to load image</span>
                    </div>
                )
            }
        </>
    )
}

export default ImageLoad