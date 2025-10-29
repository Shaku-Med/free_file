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

export const ContextProvider = ({ children, f }: ContextProviderProps) => {
    const [files, setFiles] = useState<FileType[]>(f);
    const [isModalOpen, setIsModalOpen] = useState(false);


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