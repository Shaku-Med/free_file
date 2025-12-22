import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ContextProps } from "./types";
import type { FileType } from "../types";
import MediaSelectionModal from "~/routes/Home/components/MediaSelectionModal";
import { Button } from "~/components/ui/button";
import { Plus } from "lucide-react";
// import NavigationLoader from "~/routes/Home/components/NavigationLoader";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import Cookies from "js-cookie";
import ClientEncryption from "../Security/Client/Encryption";
import { useNavigation } from "react-router";


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
    observerRef: null,
    loadMoreVideos: () => {},
    user_agent: '',
    userId: null,
    userActions: { likedFileIds: new Set(), dislikedFileIds: new Set() }
})

interface ContextProviderProps {
    children: React.ReactNode;
    f: FileType[];
    st: string;
    user_agent: string;
    userId?: string | null;
    userActions?: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
}

export const FloatingButton = () => {
    const { setIsModalOpen, userId } = useFileContext();
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

export const ContextProvider = ({ children, f, st, user_agent, userId, userActions: initialUserActions = { likedFileIds: new Set(), dislikedFileIds: new Set() } }: ContextProviderProps) => {
    const [files, setFiles] = useState<FileType[]>(f);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [userActions, setUserActions] = useState(initialUserActions);

    const [isLoading, setIsLoading] = useState(false);
    const observerRef = useRef<HTMLDivElement | null>(null)
    const nav = useNavigation()
  
    const loadMoreVideos = useCallback(async () => {
      if (isLoading) return
  
      setIsLoading(true)
      try {
        const seenIds = files
          .map((file: any) => file?.id)
          .filter((id: any): id is string => typeof id === 'string' && id.length > 0);

        const response = await fetch(`/api/feed`);
        if (!response.ok) {
          return;
        }

        const data = await response.json();

        if (Array.isArray(data?.data) && data.data.length > 0) {
          setFiles((prev: FileType[]) => [...prev, ...data.data]);

          // Merge user actions from API response
          if (data?.userActions) {
            setUserActions(prev => {
              const newLikedIds = new Set(prev.likedFileIds);
              const newDislikedIds = new Set(prev.dislikedFileIds);
              data.userActions.likedFileIds?.forEach((id: string) => newLikedIds.add(id));
              data.userActions.dislikedFileIds?.forEach((id: string) => newDislikedIds.add(id));
              return { likedFileIds: newLikedIds, dislikedFileIds: newDislikedIds };
            });
          }
        }
      }
      catch (error) {
        console.log(`Error Found In loadMoreVideos: `, error)
      } finally {
        setIsLoading(false)
      }
    }, [files, isLoading])
  
    useEffect(() => {
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
    }, [loadMoreVideos, isLoading, nav.location])

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

    const value = useMemo(
        () => ({
            files,
            setFiles,
            isModalOpen,
            setIsModalOpen,
            isLoading,
            observerRef: observerRef as React.RefObject<HTMLDivElement>,
            loadMoreVideos,
            user_agent,
            userId: safeUserId,
            userActions
        }),
        [files, isModalOpen, isLoading, loadMoreVideos, user_agent, safeUserId, userActions]
    );
    return (
        <div className={`w-full h-full`}>
            <Context.Provider value={value}>
                {children}
                <MediaSelectionModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    onFilesSelected={() => {}}
                    maxFileSizeBytes={safeUserId ? 400 * 1024 * 1024 : 40 * 1024 * 1024}
                />
                {/* <FloatingButton /> */}
                {/* <NavigationLoader/> */}
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