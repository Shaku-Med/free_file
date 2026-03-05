import type React from "react";
import type { FileType, PageCacheEntry } from "../types";

export interface ContextProps {
  files: FileType[];
  setFiles: React.Dispatch<React.SetStateAction<FileType[]>>;
  isModalOpen: boolean;
  setIsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isLoading: boolean;
  initialLoading: boolean;
  observerRef: React.RefObject<HTMLDivElement | null>;
  loadMoreVideos: () => void;
  clearFeedHistory: () => Promise<void>;
  user_agent: string;
  userId: string | null;
  userActions: { likedFileIds: Set<string>; dislikedFileIds: Set<string> };
  c_user: string | null;
  uploadServerUrl: string;
  userProfile: {
    id: string;
    username: string;
    profile_pic: string;
    about: string | null;
  } | null;
  userProfileLoading: boolean;
  pageCache: PageCacheEntry;
  setPageCache: React.Dispatch<React.SetStateAction<PageCacheEntry>>;
  /** Set true when current route's data is loaded so scroll restoration can run. */
  scrollDataReady: boolean;
  setScrollDataReady: React.Dispatch<React.SetStateAction<boolean>>;
}
