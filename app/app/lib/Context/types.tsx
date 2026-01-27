import React from "react";
import type { FileType } from "../types";

export interface UserActions {
  likedFileIds: Set<string>;
  dislikedFileIds: Set<string>;
}

export type ContextProps = {
    files: FileType[];
    setFiles: React.Dispatch<React.SetStateAction<FileType[]>>;
    isModalOpen: boolean;
    setIsModalOpen: (isModalOpen: boolean) => void;
    isLoading: boolean;
    observerRef: React.RefObject<HTMLDivElement> | null;
    loadMoreVideos: () => void;
    user_agent: string;
    userId: string | null;
    userActions: UserActions;
    c_user: string | null;
    uploadServerUrl: string;
    userProfile: {
      id: string;
      username: string;
      profile_pic: string;
      about: string | null;
    } | null;
    userProfileLoading: boolean;
}