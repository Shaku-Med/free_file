import { createContext, useContext, useLayoutEffect, useMemo, useState } from "react";
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
    setIsModalOpen: () => {}
})

interface ContextProviderProps {
    children: React.ReactNode;
    f: FileType[];
    st: string;
}

export const FloatingButton = () => {
    const { setIsModalOpen } = useFileContext();
    useLayoutEffect(() => {
        const isDriverCompleted = Cookies.get('isDriverCompleted');
        if (!isDriverCompleted) {
            driverObj.drive(0)
            Cookies.set('isDriverCompleted', 'true');
        }
    }, [])

    return (
        <Button
            onClick={() => setIsModalOpen(true)}
            size="icon"
            id="floating-button"
            className=" fixed bottom-6 right-6 z-40 h-16 w-16 rounded-3xl shadow-lg hover:shadow-xl transition-all duration-300 bg-primary hover:bg-primary/90"
        >
            <Plus className="h-7 w-7" />
        </Button>
    )
}

export const ContextProvider = ({ children, f, st }: ContextProviderProps) => {
    const [files, setFiles] = useState<FileType[]>(f);
    const [isModalOpen, setIsModalOpen] = useState(false);

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

    const value = useMemo(() => ({ files, setFiles, isModalOpen, setIsModalOpen }), [files, setFiles, isModalOpen, setIsModalOpen]);
    return (
        <Context.Provider value={value}>
            {children}
            <MediaSelectionModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onFilesSelected={() => {}}
            />
            <FloatingButton />
            {/* <NavigationLoader/> */}
        </Context.Provider>
    )
}

export const useFileContext = () => {
    const context = useContext(Context);
    if (!context) {
        throw new Error('useFileContext must be used within a FileContextProvider');
    }
    return context;
}