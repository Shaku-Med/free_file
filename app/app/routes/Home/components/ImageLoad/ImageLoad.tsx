import React, { useEffect, useLayoutEffect, useState } from 'react'
import type { FileType } from '~/lib/types'
import { cn } from '~/lib/utils'
import { Loader2, LoaderCircle } from 'lucide-react'
import { getImageBlob, hasImageBlob, storeImageBlob } from './IndexDb'
import { getImageColorsHEX } from './Canvas/Functions'

interface CallBackProps {
    src: string
    colors: string[]
}
interface ImageLoadProps {
    link?: string
    className?: string
    imageID?: string
    index?: number
    retry: () => void
    callBack?: (props: CallBackProps) => void
    quality?: number | undefined
    hasAdultTag: boolean
}
const ImageLoad = ({link, className, imageID, index, retry, callBack, quality, hasAdultTag }: ImageLoadProps) => {
    const [src, setSrc] = useState<string | null | boolean>(null)
    const [loaded, setLoaded] = useState<boolean>(false)

    useLayoutEffect(() => {
        let fetchImage = async () => {
            if(!link) return
            let videoTypes = [`.mp4`, `.mov`, `.m4v`, `.avi`, `.wmv`, `.flv`, `.webm`, `.mkv`, `.m3u8`, `.ts`]
            link = `${videoTypes.reduce((url, ext) => url.replace(new RegExp(ext.replace('.', '\\.'), 'gi'), ''), link)}${quality ? `/?quality=${quality}` : ''}`
            imageID = quality ? `${imageID}_${quality}` : imageID
            
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

            await new Promise(resolve => setTimeout(resolve, 100 * (index || 0)))
            
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
            let CLBK = async () => {
                let colors = await getImageColorsHEX({src: src as string})
                callBack && callBack({
                    src: src as string, 
                    colors: colors || []
                })
            }
            CLBK()
        }
    }, [src])

    return (
        <>
            {
                src ? (
                    <>
                    {
                        !loaded && (
                            <div className="absolute inset-0 flex items-center justify-center bg-background text-xs flex-col gap-2">
                                <LoaderCircle className="w-8 h-8 animate-spin opacity-50" />
                            </div>
                        )
                    }
                      <img
                            src={`${src}`}
                            alt={`Thumbnail`}
                            className={cn("w-full h-full object-cover animate-in fade-in-0 zoom-in-95", className)}
                            onError={() => {
                                retry()
                            }}
                            loading="lazy"
                            onLoad={e => {
                                setLoaded(true)
                            }}
                        />
                    </>
                ) : src === null ? (
                    <div className={cn("w-full h-full flex flex-col items-center justify-center bg-background text-xs", className)}>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Loading...</span>
                    </div>
                ) : (
                    <div className={cn("w-full h-full flex items-center justify-center bg-background text-xs", className)}>
                        <span>Failed to load image</span>
                    </div>
                )
            }
        </>
    )
}

export default ImageLoad