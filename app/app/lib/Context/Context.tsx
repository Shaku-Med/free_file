import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ContextProps } from "~/lib/Context/types";
import type { FileType, PageCacheEntry, DynamicSeriesPayloadCache, RelatedVideosPayloadCache } from "../types";
import { isMobile } from "react-device-detect";
import { MAX_UPLOAD_FILE_BYTES } from "~/lib/uploadLimits";
import { isSearchBotUserAgent } from "~/lib/utils";
import MediaSelectionModal from "~/routes/Home/components/MediaSelectionModal";
import { Button } from "~/components/ui/button";
import { Plus } from "lucide-react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import Cookies from "js-cookie";
import ClientEncryption from "../Security/Client/Encryption";
import { setPlayerSettings as setPlayerSettingsApi } from "~/lib/Services/playerSettingsApi";
import { useLocation, useNavigation } from "react-router";
import { isPipChromeRoute } from "~/routes/pip/pipEnv";
import { personalizationService } from "~/lib/Services/PersonalizationService";

export const driverObj = driver({
    showProgress: true,
    steps: [
      { element: '#floating-button', popover: { 
        title: 'Add Media',
        description: 'Click here to add media to your gallery',
       }},
       {
        element: '#picture_in_picture_button',
        popover: {
          title: 'Picture in Picture',
          description: 'Click here to open the picture in picture mode',
        }
       },
       {
        element: '#home_button',
        popover: {
          title: 'Home',
          description: 'Click here to go to the home page',
        }
       }
    ]
});

export const Context = createContext<ContextProps>({
    files: [],
    setFiles: () => {},
    isModalOpen: false,
    setIsModalOpen: () => {},
    isLoading: false,
    initialLoading: true,
    observerRef: { current: null },
    loadMoreVideos: () => {},
    clearFeedHistory: async () => {},
    user_agent: '',
    userId: null,
    userActions: { likedFileIds: new Set(), dislikedFileIds: new Set(), savedFileIds: new Set() },
    c_user: null,
    uploadServerUrl: '',
    userProfile: null,
    userProfileLoading: false,
    pageCache: [],
    setPageCache: () => {},
    scrollDataReady: false,
    setScrollDataReady: () => {},
    theaterMode: false,
    setTheaterMode: () => {},
    playerSettings: null,
    setPlayerSettings: () => {},
    savePlayerSettings: async () => {},
    isDevelopment: false,
    hasFetchedImages: false,
    setHasFetchedImages: () => {},
    altAccounts: [],
    hideAppChrome: false,
    setHideAppChrome: () => {},
    hlsBootstrap: null,
    hlsBootstrapRetry: null,
    getDynamicSeriesPayloadCache: () => null,
    setDynamicSeriesPayloadCache: () => {},
    getRelatedVideosPayloadCache: () => null,
    setRelatedVideosPayloadCache: () => {},
})

interface ContextProviderProps {
    children: React.ReactNode;
    st: string;
    user_agent: string;
    userId?: string | null;
    c_user: string | null;
    uploadServerUrl?: string;
    playerSettingsFromLoader?: ContextProps['playerSettings'] | null;
    isMobileServer?: boolean;
    isDevelopment?: boolean;
    altAccounts?: { id: string; username: string; profile_pic?: string | null }[];
  hlsBootstrap?: string | null;
  hlsBootstrapRetry?: string | null;
}

export const FloatingButton = () => {
    const { setIsModalOpen, userId, hideAppChrome } = useFileContext();
    const { pathname } = useLocation();
    const suppressChrome = hideAppChrome || isPipChromeRoute(pathname);
    useLayoutEffect(() => {
        const isDriverCompleted = Cookies.get('isDriverCompleted');
        if (!isDriverCompleted) {
            driverObj.drive(0)
            Cookies.set('isDriverCompleted', 'true', {
                expires: 365,
                path: '/',
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                priority: 'low'
            });
        }
    }, [])

    if (!userId) {
        return null;
    }

    if (suppressChrome) {
        return null;
    }

    return (
        <Button
            onClick={() => setIsModalOpen(true)}
            size="icon"
            id="floating-button"
            className=" fixed bottom-6 right-6 z-[10000000] h-16 w-16 rounded-3xl shadow-lg hover:shadow-xl transition-all duration-300 bg-primary hover:bg-primary/90"
        >
            <Plus className="h-7 w-7" />
        </Button>
    )
}

export const ContextProvider = ({ children, st, user_agent, userId, c_user, uploadServerUrl = '', playerSettingsFromLoader = null, isMobileServer = false, isDevelopment = false, altAccounts: altAccountsProp = [], hlsBootstrap = null, hlsBootstrapRetry = null }: ContextProviderProps) => {
    const [files, setFiles] = useState<FileType[]>([]);
    const [pageCache, setPageCache] = useState<PageCacheEntry>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [userActions, setUserActions] = useState<{ likedFileIds: Set<string>; dislikedFileIds: Set<string>; savedFileIds: Set<string> }>({ likedFileIds: new Set(), dislikedFileIds: new Set(), savedFileIds: new Set() });
    const [isDragActive, setIsDragActive] = useState(false);
    const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
    const dragDepthRef = useRef(0);
    const [userProfile, setUserProfile] = useState<{
        id: string;
        username: string;
        profile_pic: string;
        about: string | null;
    } | null>(null);
    const [userProfileLoading, setUserProfileLoading] = useState(false);
    const hasFetchedProfileRef = useRef(false);
    const [scrollDataReady, setScrollDataReady] = useState(false);

    const [isLoading, setIsLoading] = useState(false);
    const [initialLoading, setInitialLoading] = useState(true);
    const [hasMore, setHasMore] = useState(true);
    const nextCursorRef = useRef<{ cursor_pos: number } | null>(null);
    const shownIdsRef = useRef<Set<string>>(new Set());
    const feedSeedRef = useRef<string>(Date.now().toString());
    const observerRef = useRef<HTMLDivElement | null>(null)
    const nav = useNavigation()
    
    const [playerSettings, setPlayerSettings] = useState<ContextProps['playerSettings']>(playerSettingsFromLoader ?? null);
    const isMobileDevice = isMobileServer || isMobile;
    const [theaterMode, setTheaterMode] = useState<boolean>(isMobileDevice ? true : (playerSettings?.theaterMode ?? false));

    const [hasFetchedImages, setHasFetchedImages] = useState<boolean>(false);
    const [hideAppChrome, setHideAppChrome] = useState(false);
    useEffect(() => {
        if (typeof window === "undefined") return;
        if (isSearchBotUserAgent(user_agent)) return;
        setHasFetchedImages(true);
    }, [user_agent]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const mql = window.matchMedia("(max-width: 767px)");
        const sync = () => {
            if (isMobileDevice || mql.matches) {
                setTheaterMode(true);
            } else {
                setTheaterMode(playerSettings?.theaterMode ?? false);
            }
        };
        sync();
        mql.addEventListener("change", sync);
        return () => mql.removeEventListener("change", sync);
    }, [isMobileDevice, playerSettings?.theaterMode]);

    const savePlayerSettings = useCallback(async (settings: Partial<NonNullable<ContextProps['playerSettings']>>) => {
      try {
        await setPlayerSettingsApi(settings);
      } catch (error) {
        console.error('Failed to save player settings:', error);
      }
    }, []);

    // Each seed produces a bounded shuffle of the feed pool on the backend. When that
    // pool is drained we have to rotate to a fresh seed to keep scrolling "infinite",
    // the way Facebook/YouTube re-rank instead of cutting users off. Cap the rotations
    // per call so a genuinely empty feed still terminates.
    const MAX_SEED_ROTATIONS = 2
    const SEEN_IDS_WIRE_CAP = 500 // matches API's 500-id ceiling in parseIdsParam

    const recentShownIds = () => {
      const all = Array.from(shownIdsRef.current)
      return all.length > SEEN_IDS_WIRE_CAP ? all.slice(-SEEN_IDS_WIRE_CAP) : all
    }

    const fetchFeedOnce = async (append: boolean) => {
      const params = new URLSearchParams()
      params.set("seed", feedSeedRef.current)
      const cursor = nextCursorRef.current
      if (append && cursor) {
        params.set("cursor_pos", String(cursor.cursor_pos))
      }
      // Send recently-shown IDs so the backend can dedupe even within a seed; without
      // this the DB's sampler can hand back items already rendered in this session.
      const seen = recentShownIds()
      if (seen.length > 0) {
        params.set("exclude_ids", JSON.stringify(seen))
      }
      // Session-level personalization: pass categories from in-session likes
      const sessionCats = personalizationService.getSessionCategories()
      if (sessionCats.length > 0) {
        params.set("session_cats", JSON.stringify(sessionCats))
      }

      const response = await fetch(`/api/feed?${params}`)
      if (!response.ok) return { ok: false as const }
      const data = await response.json()
      return { ok: true as const, data }
    }

    const fetchFeed = useCallback(async (append: boolean) => {
      if (isLoading) return

      if (!append) {
        feedSeedRef.current = Date.now().toString();
      }

      setIsLoading(true)
      try {
        let appendedAny = false
        for (let rotation = 0; rotation <= MAX_SEED_ROTATIONS; rotation++) {
          const result = await fetchFeedOnce(append || rotation > 0)
          if (!result.ok) return
          const data = result.data

          if (Array.isArray(data?.data) && data.data.length > 0) {
            data.data.forEach((f: FileType) => {
              if (f.id) shownIdsRef.current.add(f.id)
            })
            setFiles(prev => {
              const effectiveAppend = append || rotation > 0
              if (!effectiveAppend) return data.data
              const existingIds = new Set(prev.map((f: FileType) => f.id))
              const newItems = data.data.filter((f: FileType) => !existingIds.has(f.id))
              return [...prev, ...newItems]
            })
            if (data?.userActions) {
              setUserActions(prev => {
                const newLikedIds = new Set(prev.likedFileIds)
                const newDislikedIds = new Set(prev.dislikedFileIds)
                const newSavedIds = new Set(prev.savedFileIds)
                data.userActions.likedFileIds?.forEach((id: string) => newLikedIds.add(id))
                data.userActions.dislikedFileIds?.forEach((id: string) => newDislikedIds.add(id))
                data.userActions.savedFileIds?.forEach((id: string) => newSavedIds.add(id))
                return { likedFileIds: newLikedIds, dislikedFileIds: newDislikedIds, savedFileIds: newSavedIds }
              })
            }
            appendedAny = true
          }

          nextCursorRef.current = data?.nextCursor ?? null
          const hasNext = Boolean(data?.nextCursor)
          if (hasNext) {
            setHasMore(true)
            return
          }

          // Seed exhausted. Rotate to a fresh one and try again. Only give up once we've
          // rotated a few times without seeing any new items  that's a true empty feed.
          if (rotation < MAX_SEED_ROTATIONS) {
            feedSeedRef.current = `${Date.now()}_${rotation + 1}`
            nextCursorRef.current = null
            continue
          }
          setHasMore(appendedAny) // only keep trying if this call managed to append something
          return
        }
      } catch (error) {
        console.log(`Error Found In fetchFeed: `, error)
      } finally {
        setIsLoading(false)
        setInitialLoading(false)
      }
    }, [isLoading])

    useEffect(() => {
      fetchFeed(false)
    }, [])

    useEffect(() => {
      if (!userId) return
      const markSeenOnLeave = () => {
        const ids = Array.from(shownIdsRef.current)
        if (ids.length === 0) return
        fetch('/api/mark-seen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileIds: ids })
        }).catch(() => {})
      }
      const handleVisibility = () => {
        if (document.visibilityState === 'hidden') markSeenOnLeave()
      }
      const handleBeforeUnload = () => markSeenOnLeave()
      document.addEventListener('visibilitychange', handleVisibility)
      window.addEventListener('beforeunload', handleBeforeUnload)
      return () => {
        document.removeEventListener('visibilitychange', handleVisibility)
        window.removeEventListener('beforeunload', handleBeforeUnload)
      }
    }, [userId])

    const loadMoreVideos = useCallback(() => {
      if (!hasMore) return
      fetchFeed(true)
    }, [fetchFeed, hasMore])

    const clearFeedHistory = useCallback(async () => {
      try {
        const res = await fetch('/api/feed/clear-history', { method: 'POST' })
        if (!res.ok) return
        nextCursorRef.current = null
        shownIdsRef.current = new Set()
        feedSeedRef.current = Date.now().toString()
        setHasMore(true)
        await fetchFeed(false)
      } catch (e) {
        console.error('Clear feed history failed:', e)
      }
    }, [fetchFeed])

    useEffect(() => {
      if (!userId) return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && !isLoading) {
            loadMoreVideos()
          }
        },
        { threshold: 0.1 }
      )
      if (observerRef.current) observer.observe(observerRef.current)
      return () => observer.disconnect()
    }, [loadMoreVideos, isLoading, nav.location, userId])

    // Refresh personalization data on login (interest profiles + creator affinity)
    useEffect(() => {
      if (!userId) return;
      personalizationService.refreshIfNeeded();
    }, [userId]);

    useEffect(() => {
      if (!userId || hasFetchedProfileRef.current) return;
      const fetchUserProfile = async () => {
        try {
          setUserProfileLoading(true);
          const response = await fetch(`/api/user-profile?userId=${userId}`);
          if (response.ok) {
            const data = await response.json();
            setUserProfile(data);
          }
        } catch (error) {
          console.error("Error fetching user profile:", error);
        } finally {
          setUserProfileLoading(false);
          hasFetchedProfileRef.current = true;
        }
      };
      fetchUserProfile();
    }, [userId])

    useEffect(() => {
      const hasFiles = (event: DragEvent) => {
        if (!event.dataTransfer) return false;
        return Array.from(event.dataTransfer.types || []).includes("Files");
      };

      const onDragEnter = (event: DragEvent) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        dragDepthRef.current += 1;
        setIsDragActive(true);
      };

      const onDragOver = (event: DragEvent) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
      };

      const onDragLeave = (event: DragEvent) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) {
          setIsDragActive(false);
        }
      };

      const onDrop = (event: DragEvent) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        dragDepthRef.current = 0;
        setIsDragActive(false);
        const files = Array.from(event.dataTransfer?.files || []);
        if (files.length === 0) return;
        setDroppedFiles(files);
        setIsModalOpen(true);
      };

      window.addEventListener("dragenter", onDragEnter);
      window.addEventListener("dragover", onDragOver);
      window.addEventListener("dragleave", onDragLeave);
      window.addEventListener("drop", onDrop);

      return () => {
        window.removeEventListener("dragenter", onDragEnter);
        window.removeEventListener("dragover", onDragOver);
        window.removeEventListener("dragleave", onDragLeave);
        window.removeEventListener("drop", onDrop);
      };
    }, []);

    useLayoutEffect(() => {
        let fetchPublicKey = async () => {
            try {
                if(!st) return
                let client = new ClientEncryption()
                await client.generateKeys()

                let response = await fetch('/api/public-key', {
                    headers: {
                        'Authorization': `Bearer ${st}`,
                        'Content-Type': 'application/json'
                    }
                })
                if(!response.ok) return
                let data = await response.json()

                await client.deriveSharedSecret(data.publicKey)
                const clientPublicKey = await client.getPublicKey()
                if(!clientPublicKey) return

                let handshake = await fetch(`/api/handshake`, {
                    method: 'POST',
                    body: JSON.stringify({ clientPublicKey }),
                    headers: {
                        'Authorization': `Bearer ${data.session}`,
                        'Content-Type': 'application/json'
                    }
                })
                if(!handshake.ok) return
                let handshakeData = await handshake.json()
                console.log('handshakeData', handshakeData)
            }
            catch (error) {
                console.error('Error in fetchPublicKey:', error)
                return null
            }
        }
        
        if(st && !st.includes('not_needed')) fetchPublicKey()
    }, [st])

    const safeUserId: string | null = userId ?? null;

    const dynamicSeriesPayloadCacheRef = useRef(
        new Map<string, DynamicSeriesPayloadCache>()
    );
    const relatedVideosPayloadCacheRef = useRef(
        new Map<string, RelatedVideosPayloadCache>()
    );

    const getDynamicSeriesPayloadCache = useCallback((fileSeriesId: string) => {
        return dynamicSeriesPayloadCacheRef.current.get(fileSeriesId) ?? null;
    }, []);

    const setDynamicSeriesPayloadCache = useCallback(
        (fileSeriesId: string, entry: DynamicSeriesPayloadCache) => {
            dynamicSeriesPayloadCacheRef.current.set(fileSeriesId, entry);
        },
        []
    );

    const getRelatedVideosPayloadCache = useCallback((fileId: string) => {
        return relatedVideosPayloadCacheRef.current.get(fileId) ?? null;
    }, []);

    const setRelatedVideosPayloadCache = useCallback(
        (fileId: string, entry: RelatedVideosPayloadCache) => {
            relatedVideosPayloadCacheRef.current.set(fileId, entry);
        },
        []
    );

    useEffect(() => {
        dynamicSeriesPayloadCacheRef.current.clear();
        relatedVideosPayloadCacheRef.current.clear();
    }, [safeUserId]);

    const value = useMemo(
        () => ({
            files,
            setFiles,
            isModalOpen,
            setIsModalOpen,
            isLoading,
            initialLoading,
            observerRef: observerRef as React.RefObject<HTMLDivElement>,
            loadMoreVideos,
            clearFeedHistory,
            user_agent,
            userId: safeUserId,
            userActions,
            c_user,
            uploadServerUrl,
            userProfile,
            userProfileLoading,
            pageCache,
            setPageCache,
            scrollDataReady,
            setScrollDataReady,
            theaterMode,
            setTheaterMode,
            playerSettings,
            setPlayerSettings,
            savePlayerSettings,
            isDevelopment,
            hasFetchedImages,
            setHasFetchedImages,
            altAccounts: altAccountsProp,
            hideAppChrome,
            setHideAppChrome,
            hlsBootstrap,
            hlsBootstrapRetry,
            getDynamicSeriesPayloadCache,
            setDynamicSeriesPayloadCache,
            getRelatedVideosPayloadCache,
            setRelatedVideosPayloadCache,
        }),
        [files, isModalOpen, isLoading, initialLoading, loadMoreVideos, clearFeedHistory, user_agent, safeUserId, userActions, c_user, uploadServerUrl, userProfile, userProfileLoading, pageCache, scrollDataReady, theaterMode, playerSettings, savePlayerSettings, altAccountsProp, hideAppChrome, hlsBootstrap, hlsBootstrapRetry, getDynamicSeriesPayloadCache, setDynamicSeriesPayloadCache, getRelatedVideosPayloadCache, setRelatedVideosPayloadCache]
    );
    
    return (
        <div className={`w-full h-full`}>
            <Context.Provider value={value}>
                {children}
                {isDragActive && (
                    <div className="fixed inset-0 z-[10000001] bg-background/80 backdrop-blur-sm flex items-center justify-center pointer-events-none">
                        <div className="rounded-2xl border border-dashed border-primary/60 bg-background/90 px-6 py-8 text-center shadow-lg">
                            <p className="text-base font-semibold text-foreground">Drop files to upload</p>
                            <p className="text-xs text-muted-foreground mt-1">Images and videos supported</p>
                        </div>
                    </div>
                )}
                <MediaSelectionModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    onFilesSelected={() => {}}
                    maxFileSizeBytes={MAX_UPLOAD_FILE_BYTES}
                    initialFiles={droppedFiles}
                    onFilesConsumed={() => setDroppedFiles([])}
                />
            </Context.Provider>
        </div>
    )
}

export const useFileContext = () => {
    const context = useContext(Context);
    if (!context) {
        throw new Error('useFileContext must be used within a FileContextProvider');
    }
    return context;
}
