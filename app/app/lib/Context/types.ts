import type React from "react";
import type { FileType, PageCacheEntry } from "../types";

export type PlayerSettings = {
  theaterMode: boolean;
  volume: number;
  muted: boolean;
  playbackRate: number;
  stableVolume: boolean;
  loop: boolean;
  autoPlay: boolean;
  ambientMode: boolean;
  quality: string;
};

export type PlayerSettingsPatch = Partial<PlayerSettings>;

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
  scrollDataReady: boolean;
  setScrollDataReady: React.Dispatch<React.SetStateAction<boolean>>;
  theaterMode: boolean;
  setTheaterMode: React.Dispatch<React.SetStateAction<boolean>>;
  playerSettings: PlayerSettings | null;
  setPlayerSettings: React.Dispatch<React.SetStateAction<PlayerSettings | null>>;
  savePlayerSettings: (patch: PlayerSettingsPatch) => Promise<void>;
  isDevelopment: boolean;
}