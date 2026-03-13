import React, { useEffect, useLayoutEffect, useMemo, useState, useRef, useCallback } from 'react'
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
    /** Blob URL from fetch, for media session (when getMediaSessionURL is true) */
    mediaSessionUrl?: string
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
    getMediaSessionURL?: boolean
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
    getMediaSessionURL = false,
}: ImageLoadProps) => {
    const { c_user, userId, files, isDevelopment } = useFileContext()
    const [src, setSrc] = useState<string | null | boolean>(null)
    const [error, setError] = useState<boolean>(false)
    const [loaded, setLoaded] = useState<boolean>(false)
    const [isPreviewOpen, setIsPreviewOpen] = useState(false)
    const [secondaryBaseUrl, setSecondaryBaseUrl] = useState<null | string>(null)
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

    const retryRef = useRef(retry)
    retryRef.current = retry
    const callBackRef = useRef(callBack)
    callBackRef.current = callBack

    const resolvedLink = useMemo(() => {
        if (!link) return null;
        try {
            let videoTypes = [`.mp4`, `.mov`, `.m4v`, `.avi`, `.wmv`, `.flv`, `.webm`, `.mkv`, `.m3u8`, `.ts`]
            let lk = `${videoTypes.reduce((url, ext) => url.replace(new RegExp(ext.replace('.', '\\.'), 'gi'), ''), link)}${quality ? `/?quality=${quality}` : ''}`
            return lk
        } catch (error) {
            console.error('Failed to resolve link:', error)
            return null
        }
    }, [link, quality]);

    const resolvedImageID = useMemo(
        () => (quality && imageID ? `${imageID}_${quality}` : imageID ?? ''),
        [imageID, quality],
    );

    const hasFetchedRef = useRef(false)

    useLayoutEffect(() => {
        hasFetchedRef.current = false
    }, [resolvedLink, resolvedImageID])

    useLayoutEffect(() => {
        if (!inView || !resolvedLink || hasFetchedRef.current) return
        hasFetchedRef.current = true

        let cancelled = false

        let fetchImage = async () => {
            if (!resolvedLink) return

            if (resolvedImageID && (window as any)[`_${resolvedImageID}`]) {
                if (!cancelled) {
                    setSrc((window as any)[`_${resolvedImageID}`].imageUrl)
                    setError(false)
                }
                return
            }

            if (resolvedImageID && await hasImageBlob(resolvedImageID)) {
                const cachedImage = await getImageBlob(resolvedImageID)
                if (cachedImage && !cancelled) {
                    const currentCache = (window as any)[`_${resolvedImageID}`] || {};
                    (window as any)[`_${resolvedImageID}`] = {
                        ...currentCache,
                        imageUrl: cachedImage.url,
                    }
                    setSrc(cachedImage.url)
                    setError(false)
                    return
                }
            }

            try {
                let response = await fetch(`${secondaryBaseUrl || IMAGE_BASE_URL}${resolvedLink}`, {
                    method: 'GET',
                    headers: {
                        'c-user': c_user ? `${c_user}` : '',
                    },
                    mode: 'cors',
                })
                if (!response.ok) {
                    if (!cancelled) setError(true)
                    return
                }
                let blob = await response.blob()
                if (cancelled) return
                let blobURL = URL.createObjectURL(blob)
    
                if (resolvedImageID) {
                    const currentCache = (window as any)[`_${resolvedImageID}`] || {};
                    (window as any)[`_${resolvedImageID}`] = {
                        ...currentCache,
                        imageUrl: blobURL,
                    }
    
                    try {
                        await storeImageBlob(resolvedImageID, blob, resolvedLink)
                    } catch (error) {
                        return;
                    }
                }
    
                let image = new Image()
                image.src = blobURL
                image.onload = () => {
                    if (!cancelled) {
                        setSrc(image.src)
                        setError(false)
                    }
                }
                image.onerror = () => {
                    if (!cancelled) setError(true)
                }
            }
            catch {
                if (!cancelled) setError(true)
            }

        }
        fetchImage()

        return () => { cancelled = true }
    }, [inView, resolvedLink, resolvedImageID])

    useEffect(() => {
        if (src && typeof src === 'string' && callBackRef.current && inView && !loaded) {
            let CLBK = async () => {
                try {
                    let colors = await getImageColorsHEX({ src: src as string })
                    setColors(colors || [])
                    callBackRef.current?.({
                        src: src as string,
                        colors: colors || [],
                        ...(getMediaSessionURL && { mediaSessionUrl: src as string }),
                    })
                    return
                }
                catch (error) {
                    console.error('Failed to get image colors:', error)
                    retryRef.current()
                }
            }
            CLBK()
        }
    }, [src, inView, loaded, getMediaSessionURL])

    useEffect(() => {
        if(window !== undefined) {
            if(isDevelopment) {
                setSecondaryBaseUrl(`${window.location.protocol}//${window.location.hostname}:3001`)
            }
        } else {
            setSecondaryBaseUrl(null)
        }
    }, [])

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

    const hasBlobSrc = typeof src === 'string' && !!src
    const canShowFromUrl = !hasAdultTag && (resolvedLink && !error)
    const canShowImage = hasAdultTag ? hasBlobSrc : (hasBlobSrc || canShowFromUrl)

    return (
        <>
            <div
                ref={ref}
                className={cn("w-full h-full relative", shouldShowPreview && "cursor-pointer", className)}
                onClick={handlePreviewOpen}
            >
                {canShowImage ? (
                    <>
                        {!loaded && (
                            <div className="absolute top-2 right-2 h-fit w-fit flex items-center justify-center text-xs flex-col gap-2">
                                <LoaderCircle className="w-full h-full min-h-2 min-w-2 max-w-8 max-h-8 animate-spin opacity-50" />
                            </div>
                        )}
                        <img
                            src={hasAdultTag ? (src as string) : (!files.length && hasBlobSrc ? src : `${secondaryBaseUrl || IMAGE_BASE_URL}${resolvedLink}`)}
                            alt="Thumbnail"
                            className={cn("w-full h-full object-cover animate-in fade-in-0 zoom-in-95", className)}
                            loading="lazy"
                            onError={() => retryRef.current()}
                            onLoad={() => setLoaded(true)}
                        />
                        {multipleImages.length > 1 && (
                            <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
                                {(multipleCurrentImageIndex || 0) + 1}/{multipleImages.length}
                            </div>
                        )}
                    </>
                ) : src === null && !error ? (
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