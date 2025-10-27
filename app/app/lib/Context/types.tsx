import React from "react";
import type { FileType } from "../types";

export type ContextProps = {
    files: FileType[];
    setFiles: React.Dispatch<React.SetStateAction<FileType[]>>;
    isModalOpen: boolean;
    setIsModalOpen: (isModalOpen: boolean) => void;
}