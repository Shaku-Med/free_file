import React, { useEffect, useLayoutEffect, useMemo, useState, useRef, useCallback } from 'react'
import { useInView } from 'react-intersection-observer'
import { cn, isSearchBotUserAgent } from '~/lib/utils'
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
    /** Modals/portals: IO often flips false after open and cancels work — treat as always visible for loading. */
    eagerLoad?: boolean
    /** Use same-origin `/api/...` as <img src> (avoids dev :3000 vs IMAGE_BASE_URL :3001 mismatches). */
    useRelativeApiUrl?: boolean
}

const MAX_FETCH_RECOVERY_ATTEMPTS = 3

function ImageLoadShimmer({
    overlay,
    className,
}: {
    overlay?: boolean
    className?: string
}) {
    return (
        <div
            className={cn(
                'pointer-events-none overflow-hidden rounded-[inherit] border border-border/35 bg-muted/20',
                overlay && 'absolute inset-0 z-[1]',
                !overlay && 'h-full min-h-[3rem] w-full flex-1',
                className,
            )}
            aria-hidden
        >
            <div className="image-load-shimmer-bg size-full min-h-0" />
        </div>
    )
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
    eagerLoad = false,
    useRelativeApiUrl = false,
}: ImageLoadProps) => {
    const { c_user, files, isDevelopment, hasFetchedImages, user_agent } = useFileContext()
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
    const [containerBox, setContainerBox] = useState({ w: 0, h: 0 })
    const [preferFetchedBlob, setPreferFetchedBlob] = useState(false)
    const containerRef = useRef<HTMLDivElement | null>(null)
    const imgRef = useRef<HTMLImageElement | null>(null)
    const recoveryBlobRef = useRef<string | null>(null)
    const fetchRecoveryRemaining = useRef(MAX_FETCH_RECOVERY_ATTEMPTS)
    const recoveryInFlight = useRef(false)

    const { ref: setInViewRef, inView } = useInView({
        threshold: 0,
        triggerOnce: false,
        rootMargin: '50px',
    })
    const inViewForLoad = eagerLoad || inView

    const setContainerRef = useCallback(
        (node: HTMLDivElement | null) => {
            containerRef.current = node
            setInViewRef(node)
        },
        [setInViewRef],
    )

    const retryRef = useRef(retry)
    retryRef.current = retry
    const callBackRef = useRef(callBack)
    callBackRef.current = callBack

    const resolvedLink = useMemo(() => {
        if (!link) return null;
        try {
            let videoTypes = [`.mp4`, `.mov`, `.m4v`, `.avi`, `.wmv`, `.flv`, `.webm`, `.mkv`, `.m3u8`, `.ts`]
            let lk = `${videoTypes.reduce((url, ext) => url.replace(new RegExp(ext.replace('.', '\\.'), 'gi'), ''), link)}${quality ? `/?quality=${quality}&is_metadata=true` : ''}`
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

    const isSearchBot = useMemo(() => isSearchBotUserAgent(user_agent), [user_agent])

    /**
     * Crawlers: canonical `https?://…` on `<img>` only (no blob / IDB).
     * `!hasFetchedImages`: same for humans (SSR + first paint) so HTML is indexable.
     * After `hasFetchedImages`: row 0 stays URL+cache; other rows use fetch+IDB (adult/media-session always blob when needed).
     */
    const needsBlobFetch = useMemo(() => {
        if (isSearchBot) return false
        if (!hasFetchedImages) return hasAdultTag || getMediaSessionURL
        return hasAdultTag || getMediaSessionURL || index !== 0
    }, [isSearchBot, hasFetchedImages, hasAdultTag, getMediaSessionURL, index])

    const hasFetchedRef = useRef(false)

    useLayoutEffect(() => {
        hasFetchedRef.current = false
        if (recoveryBlobRef.current) {
            URL.revokeObjectURL(recoveryBlobRef.current)
            recoveryBlobRef.current = null
        }
        fetchRecoveryRemaining.current = MAX_FETCH_RECOVERY_ATTEMPTS
        recoveryInFlight.current = false
        setPreferFetchedBlob(false)
        setSrc(null)
        setError(false)
        setLoaded(false)
    }, [resolvedLink, resolvedImageID, needsBlobFetch])

    useLayoutEffect(() => {
        if (!inViewForLoad || !resolvedLink || hasFetchedRef.current) return

        let cancelled = false

        const fetchImage = async () => {
            if (!resolvedLink) return

            if (!needsBlobFetch) {
                hasFetchedRef.current = true

                if (isSearchBot) {
                    if (!cancelled) setError(false)
                    return
                }

                if (resolvedImageID && (window as any)[`_${resolvedImageID}`]) {
                    const cachedUrl = (window as any)[`_${resolvedImageID}`].imageUrl as string
                    if (!cancelled) {
                        setSrc(cachedUrl)
                        setError(false)
                        const nextColors = shouldShowPreview ? await getImageColorsHEX({ src: cachedUrl }) : []
                        setColors(nextColors || [])
                        callBackRef.current?.({
                            src: cachedUrl,
                            colors: nextColors || [],
                            ...(getMediaSessionURL && { mediaSessionUrl: cachedUrl }),
                        })
                    }
                    return
                }

                if (resolvedImageID && (await hasImageBlob(resolvedImageID))) {
                    const cachedImage = await getImageBlob(resolvedImageID)
                    if (cachedImage && !cancelled) {
                        const currentCache = (window as any)[`_${resolvedImageID}`] || {}
                        ;(window as any)[`_${resolvedImageID}`] = {
                            ...currentCache,
                            imageUrl: cachedImage.url,
                        }
                        setSrc(cachedImage.url)
                        setError(false)
                        const nextColors = shouldShowPreview
                            ? await getImageColorsHEX({ src: cachedImage.url })
                            : []
                        setColors(nextColors || [])
                        callBackRef.current?.({
                            src: cachedImage.url,
                            colors: nextColors || [],
                            ...(getMediaSessionURL && { mediaSessionUrl: cachedImage.url }),
                        })
                    }
                    return
                }

                if (!cancelled) setError(false)
                return
            }

            hasFetchedRef.current = true

            if (resolvedImageID && (window as any)[`_${resolvedImageID}`]) {
                const cachedUrl = (window as any)[`_${resolvedImageID}`].imageUrl as string
                if (!cancelled) {
                    setSrc(cachedUrl)
                    setError(false)
                    const nextColors = shouldShowPreview ? await getImageColorsHEX({ src: cachedUrl }) : []
                    setColors(nextColors || [])
                    callBackRef.current?.({
                        src: cachedUrl,
                        colors: nextColors || [],
                        ...(getMediaSessionURL && { mediaSessionUrl: cachedUrl }),
                    })
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

                    const nextColors = shouldShowPreview ? await getImageColorsHEX({ src: cachedImage.url }) : []
                    setColors(nextColors || [])
                    callBackRef.current?.({
                        src: cachedImage.url,
                        colors: nextColors || [],
                        ...(getMediaSessionURL && { mediaSessionUrl: cachedImage.url }),
                    })
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
                image.onload = async () => {
                    if (!cancelled) {
                        setSrc(image.src)
                        setError(false)
                        const nextColors = shouldShowPreview ? await getImageColorsHEX({ src: image.src }) : []
                        setColors(nextColors || [])
                        callBackRef.current?.({
                            src: image.src,
                            colors: nextColors || [],
                            ...(getMediaSessionURL && { mediaSessionUrl: image.src }),
                        })
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

        return () => {
            cancelled = true
        }
    }, [
        inViewForLoad,
        resolvedLink,
        resolvedImageID,
        needsBlobFetch,
        isSearchBot,
        c_user,
        secondaryBaseUrl,
        shouldShowPreview,
        getMediaSessionURL,
    ])

    const absoluteImageUrl = useMemo(() => {
        if (!resolvedLink) return null
        return `${secondaryBaseUrl || IMAGE_BASE_URL}${resolvedLink}`
    }, [resolvedLink, secondaryBaseUrl])

    const imgUrlForUrlMode = useMemo(() => {
        if (!resolvedLink) return ''
        if (useRelativeApiUrl && resolvedLink.startsWith('/')) {
            return resolvedLink
        }
        return absoluteImageUrl ?? ''
    }, [resolvedLink, useRelativeApiUrl, absoluteImageUrl])

    const colorSampleSrc = useMemo(() => {
        if (!resolvedLink) return null
        if (useRelativeApiUrl && resolvedLink.startsWith('/') && typeof window !== 'undefined') {
            return `${window.location.origin}${resolvedLink}`
        }
        return absoluteImageUrl
    }, [resolvedLink, useRelativeApiUrl, absoluteImageUrl])

    useLayoutEffect(() => {
        const el = containerRef.current
        if (!el || typeof ResizeObserver === 'undefined') return
        const ro = new ResizeObserver((entries) => {
            const cr = entries[0]?.contentRect
            if (!cr) return
            setContainerBox({ w: cr.width, h: cr.height })
        })
        ro.observe(el)
        return () => ro.disconnect()
    }, [])

    const fetchCtxRef = useRef({
        c_user: null as string | null,
        secondaryBaseUrl: null as string | null,
        resolvedLink: null as string | null,
        useRelativeApiUrl: false,
    })
    fetchCtxRef.current = { c_user, secondaryBaseUrl, resolvedLink, useRelativeApiUrl }

    const handleImgError = useCallback(() => {
        if (recoveryInFlight.current) return
        const ctx = fetchCtxRef.current
        if (!ctx.resolvedLink) {
            setError(true)
            setLoaded(false)
            retryRef.current()
            return
        }
        recoveryInFlight.current = true
        const path = ctx.resolvedLink
        void (async () => {
            try {
                while (fetchRecoveryRemaining.current > 0) {
                    fetchRecoveryRemaining.current -= 1
                    try {
                        const recoveryUrl =
                            ctx.useRelativeApiUrl &&
                            path.startsWith('/') &&
                            typeof window !== 'undefined'
                                ? `${window.location.origin}${path}`
                                : `${ctx.secondaryBaseUrl || IMAGE_BASE_URL}${path}`
                        const res = await fetch(recoveryUrl, {
                            method: 'GET',
                            headers: { 'c-user': ctx.c_user ? `${ctx.c_user}` : '' },
                            mode: 'cors',
                        })
                        if (!res.ok) continue
                        const blob = await res.blob()
                        if (!blob.size) continue
                        const objectUrl = URL.createObjectURL(blob)
                        if (recoveryBlobRef.current) URL.revokeObjectURL(recoveryBlobRef.current)
                        recoveryBlobRef.current = objectUrl
                        setPreferFetchedBlob(true)
                        setSrc(objectUrl)
                        setLoaded(false)
                        setError(false)
                        return
                    } catch {
                        continue
                    }
                }
                setError(true)
                setLoaded(false)
                retryRef.current()
            } finally {
                recoveryInFlight.current = false
            }
        })()
    }, [])

    useEffect(() => {
        return () => {
            if (recoveryBlobRef.current) {
                URL.revokeObjectURL(recoveryBlobRef.current)
                recoveryBlobRef.current = null
            }
        }
    }, [])

    /** Canonical-URL thumbnails: colors after `<img onLoad>`. Skip if we already show an IDB/memory blob. */
    useEffect(() => {
        const showingBlobInsteadOfCdn =
            !needsBlobFetch && typeof src === 'string' && !!src
        if (
            isSearchBot ||
            needsBlobFetch ||
            showingBlobInsteadOfCdn ||
            !callBackRef.current ||
            !inViewForLoad ||
            !loaded ||
            !colorSampleSrc
        ) {
            return
        }

        let cancelled = false
        ;(async () => {
            try {
                const nextColors = shouldShowPreview ? await getImageColorsHEX({ src: colorSampleSrc }) : []
                if (cancelled) return
                setColors(nextColors || [])
                callBackRef.current?.({
                    src: colorSampleSrc,
                    colors: nextColors || [],
                })
            } catch (error) {
                console.error('Failed to get image colors:', error)
                if (!cancelled) retryRef.current()
            }
        })()

        return () => {
            cancelled = true
        }
    }, [inViewForLoad, loaded, needsBlobFetch, colorSampleSrc, shouldShowPreview, src, isSearchBot])

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
        const singlePreview =
            typeof src === 'string' && src
                ? [src]
                : colorSampleSrc
                  ? [colorSampleSrc]
                  : absoluteImageUrl
                    ? [absoluteImageUrl]
                    : []
        setPreviewData({
            images: multipleImages.length > 0 ? multipleImages : singlePreview,
            index: multipleCurrentImageIndex || 0,
        })
    }

    const hasBlobSrc = typeof src === 'string' && !!src
    const useBlobForDisplay =
        needsBlobFetch || preferFetchedBlob || (!files.length && hasBlobSrc)
    const imgDisplaySrc =
        useBlobForDisplay && typeof src === 'string' && src ? (src as string) : imgUrlForUrlMode

    const canShowFromUrl = !needsBlobFetch && !!resolvedLink && !error
    const canShowImage = needsBlobFetch ? hasBlobSrc : hasBlobSrc || canShowFromUrl || preferFetchedBlob

    /** Cached images often finish before `onLoad` is attached — clear loading layer / opacity. */
    useLayoutEffect(() => {
        if (!canShowImage || !imgDisplaySrc) return
        const el = imgRef.current
        if (!el) return
        if (el.complete && el.naturalWidth > 0) {
            setLoaded(true)
        } else {
            setLoaded(false)
        }
    }, [canShowImage, imgDisplaySrc])

    return (
        <>
            <div
                ref={setContainerRef}
                className={cn("w-full h-full relative overflow-hidden", shouldShowPreview && "cursor-pointer", className)}
                style={
                    {
                        ['--il-w' as string]: `${Math.max(0, Math.round(containerBox.w))}px`,
                        ['--il-h' as string]: `${Math.max(0, Math.round(containerBox.h))}px`,
                    } as React.CSSProperties
                }
                onClick={handlePreviewOpen}
            >
                {canShowImage ? (
                    <>
                        {!loaded && <ImageLoadShimmer overlay />}
                        <img
                            ref={imgRef}
                            key={imgDisplaySrc}
                            src={imgDisplaySrc}
                            alt="Thumbnail"
                            className={cn(
                                "relative z-[2] h-full w-full object-cover animate-in fade-in-0 zoom-in-95",
                                loaded ? "opacity-100" : "opacity-0",
                                className,
                            )}
                            loading={eagerLoad || index === 0 ? 'eager' : 'lazy'}
                            onError={handleImgError}
                            onLoad={() => setLoaded(true)}
                        />
                        {multipleImages.length > 1 && (
                            <div className="absolute top-2 right-2 z-[3] bg-black/60 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
                                {(multipleCurrentImageIndex || 0) + 1}/{multipleImages.length}
                            </div>
                        )}
                    </>
                ) : src === null && !error ? (
                    <div
                        className={cn('flex h-full w-full flex-col rounded-[inherit]', className)}
                        role="status"
                        aria-live="polite"
                        aria-label="Loading thumbnail"
                    >
                        <ImageLoadShimmer />
                    </div>
                ) : (
                    <div
                        className={cn(
                            "flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-[inherit] bg-muted/25 px-2 text-center text-xs text-muted-foreground",
                            className,
                        )}
                    >
                        <span className="max-w-[12rem] leading-snug">Couldn’t load this image</span>
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