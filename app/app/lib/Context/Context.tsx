import { createContext, useContext, useMemo, useState } from "react";
import type { ContextProps } from "./types";
import type { FileType } from "../types";
import MediaSelectionModal from "~/routes/Home/components/MediaSelectionModal";
import { Button } from "~/components/ui/button";
import { Plus } from "lucide-react";

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
    return (
        <Button
            onClick={() => setIsModalOpen(true)}
            size="icon"
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