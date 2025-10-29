import React, { useEffect, useLayoutEffect, useState } from 'react'
import type { FileType } from '~/lib/types'
import { cn } from '~/lib/utils'
import { Loader2 } from 'lucide-react'
import { getImageBlob, hasImageBlob, storeImageBlob } from './IndexDb'
interface ImageLoadProps {
    link?: string
    className?: string
    imageID?: string
    index?: number
    retry: () => void
    callBack?: (src: string) => void
}
const ImageLoad = ({link, className, imageID, index, retry, callBack }: ImageLoadProps) => {
    const [src, setSrc] = useState<string | null | boolean>(null)

    useLayoutEffect(() => {
        let fetchImage = async () => {
            if(!link) return
            link = link.split(`.MP4.m3u8`).join('')
            
            if(imageID && (window as any)[`_${imageID}`]) {
                setSrc((window as any)[`_${imageID}`].imageUrl)
                return
            }

            if(imageID && await hasImageBlob(imageID)) {
                const cachedImage = await getImageBlob(imageID)
                if(cachedImage) {
                    const currentCache = (window as any)[`_${imageID}`] || {};
                    (window as any)[`_${imageID}`] = {
                        ...currentCache,
                        imageUrl: cachedImage.url
                    }
                    setSrc(cachedImage.url)
                    return
                }
            }

            await new Promise(resolve => setTimeout(resolve, 200 * (index || 0)))
            
            let response = await fetch(link)
            if(!response.ok) {
                retry()
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
                
                try {
                    await storeImageBlob(imageID, blob, link)
                } catch (error) {
                    console.error('Failed to store image in IndexedDB:', error)
                }
            }
            
            let image = new Image()
            image.src = blobURL
            image.onload = () => {
                setSrc(image.src)
            }
            image.onerror = () => {
                retry()
            }
        }
        if(link) {
            fetchImage()
        }
    }, [link, imageID, index])

    useEffect(() => {
        if(src && typeof src === 'string' && callBack) {
            callBack?.(src as string)
        }
    }, [src])

    return (
        <>
            {
                src ? (
                    <>
                      <img
                            src={`${src}`}
                            alt={`Thumbnail`}
                            className={cn("w-full h-full object-cover animate-in fade-in-0 zoom-in-95", className)}
                            onError={() => {
                                retry()
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