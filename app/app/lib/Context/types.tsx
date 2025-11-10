import React from "react";
import type { FileType } from "../types";

export type ContextProps = {
    files: FileType[];
    setFiles: React.Dispatch<React.SetStateAction<FileType[]>>;
    isModalOpen: boolean;
    setIsModalOpen: (isModalOpen: boolean) => void;
    isLoading: boolean;
    hasMore: boolean;
    observerRef: React.RefObject<HTMLDivElement> | null;
    currentPage: number;
    loadMoreVideos: () => void;
}