import { createContext, useContext, useMemo, useState } from "react";
import type { ContextProps } from "./types";
import type { FileRecord } from "../Services/FileService";

export const Context = createContext<ContextProps>({
    files: [],
    setFiles: () => {}
})

interface ContextProviderProps {
    children: React.ReactNode;
    f: FileRecord[];
}

export const ContextProvider = ({ children, f }: ContextProviderProps) => {
    const [files, setFiles] = useState<FileRecord[]>(f);
    const value = useMemo(() => ({ files, setFiles }), [files, setFiles]);
    return (
        <Context.Provider value={value}>
            {children}
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