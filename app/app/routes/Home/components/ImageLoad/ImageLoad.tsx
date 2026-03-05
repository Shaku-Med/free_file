import React, { useEffect, useLayoutEffect, useState, useRef } from 'react'
import { useInView } from 'react-intersection-observer'
import { cn } from '~/lib/utils'
import { Loader2, LoaderCircle } from 'lucide-react'
import { getImageBlob, hasImageBlob, storeImageBlob } from './IndexDb'
import { getImageColorsHEX } from './Canvas/Functions'
import { IMAGE_BASE_URL } from '~/lib/URLS'
import { useFileContext } from '~/lib/Context/Context'
import { AnimatePresence } from 'motion/react'
import ImgPreview from './ImgPreview/ImgPreview'

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
    shouldShowPreview?: boolean
    multipleImages?: string[]
    multipleCurrentImageIndex?: number
}

const ImageLoad = ({
    link,
    className,
    imageID,
    index,
    retry,
    callBack,
    quality,
    hasAdultTag,
    shouldShowPreview = false,
    multipleImages = [],
    multipleCurrentImageIndex = 0,
}: ImageLoadProps) => {
    const { c_user } = useFileContext()
    const [src, setSrc] = useState<string | null | boolean>(null)
    const [loaded, setLoaded] = useState<boolean>(false)
    const [isPreviewOpen, setIsPreviewOpen] = useState(false)
    const [previewData, setPreviewData] = useState<{ images: string[]; index: number }>({
        images: [],
        index: 0,
    })
    const [colors, setColors] = useState<string[]>([])
    const { ref, inView } = useInView({
        threshold: 0,
        triggerOnce: false,
        rootMargin: '50px',
    })

    useLayoutEffect(() => {
        if (!inView || !link) return

        let fetchImage = async () => {
            if (!link) return
            let videoTypes = [`.mp4`, `.mov`, `.m4v`, `.avi`, `.wmv`, `.flv`, `.webm`, `.mkv`, `.m3u8`, `.ts`]
            link = `${videoTypes.reduce((url, ext) => url.replace(new RegExp(ext.replace('.', '\\.'), 'gi'), ''), link)}${quality ? `/?quality=${quality}` : ''}`
            imageID = quality ? `${imageID}_${quality}` : imageID

            if (imageID && (window as any)[`_${imageID}`]) {
                setSrc((window as any)[`_${imageID}`].imageUrl)
                return
            }

            if (imageID && await hasImageBlob(imageID)) {
                const cachedImage = await getImageBlob(imageID)
                if (cachedImage) {
                    const currentCache = (window as any)[`_${imageID}`] || {};
                    (window as any)[`_${imageID}`] = {
                        ...currentCache,
                        imageUrl: cachedImage.url,
                    }
                    setSrc(cachedImage.url)
                    return
                }
            }

            let response = await fetch(`${IMAGE_BASE_URL}${link}`, {
                method: 'GET',
                headers: {
                    'c-user': c_user ? `${c_user}` : '',
                },
                mode: 'cors',
            })
            if (!response.ok) {
                retry()
                return
            }
            let blob = await response.blob()
            let blobURL = URL.createObjectURL(blob)

            if (imageID) {
                const currentCache = (window as any)[`_${imageID}`] || {};
                (window as any)[`_${imageID}`] = {
                    ...currentCache,
                    imageUrl: blobURL,
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
        fetchImage()
    }, [inView, link, imageID, index, quality, retry])

    useEffect(() => {
        if (src && typeof src === 'string' && callBack && inView && !loaded) {
            let CLBK = async () => {
                let colors = await getImageColorsHEX({ src: src as string })
                setColors(colors || [])
                callBack && callBack({
                    src: src as string,
                    colors: colors || [],
                })
            }
            CLBK()
        }
    }, [src, inView, callBack, loaded])

    const handlePreviewOpen = (e: React.MouseEvent) => {
        if (!shouldShowPreview) return
        e.preventDefault()
        e.stopPropagation()
        setIsPreviewOpen(true)
        setPreviewData({
            images: multipleImages.length > 0 ? multipleImages : (typeof src === 'string' && src ? [src] : []),
            index: multipleCurrentImageIndex || 0,
        })
    }

    return (
        <>
            <div
                ref={ref}
                className={cn("w-full h-full relative", shouldShowPreview && "cursor-pointer", className)}
                onClick={handlePreviewOpen}
            >
                {src ? (
                    <>
                        {!loaded && (
                            <div className="absolute inset-0 flex items-center justify-center bg-background text-xs flex-col gap-2">
                                <LoaderCircle className="w-8 h-8 animate-spin opacity-50" />
                            </div>
                        )}
                        <img
                            src={`${src}`}
                            alt="Thumbnail"
                            className={cn("w-full h-full object-cover animate-in fade-in-0 zoom-in-95", className)}
                            onError={() => retry()}
                            loading="lazy"
                            onLoad={() => setLoaded(true)}
                        />
                        {multipleImages.length > 1 && (
                            <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
                                {(multipleCurrentImageIndex || 0) + 1}/{multipleImages.length}
                            </div>
                        )}
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
                )}
            </div>

            <AnimatePresence>
                {isPreviewOpen && (
                    <ImgPreview
                        images={previewData.images}
                        index={previewData.index}
                        isOpen={isPreviewOpen}
                        setIsOpen={setIsPreviewOpen}
                        colors={colors}
                    />
                )}
            </AnimatePresence>
        </>
    )
}

export default ImageLoad