import type { FileRecord } from "../Services/FileService";

export type ContextProps = {
    files: FileRecord[];
    setFiles: (files: FileRecord[]) => void;
}