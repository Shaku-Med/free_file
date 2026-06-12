import type React from "react";
import type {
  DynamicSeriesPayloadCache,
  FileType,
  PageCacheEntry,
  RelatedVideosPayloadCache,
} from "../types";

export type PlayerSettings = {
  theaterMode: boolean;
  sidebarOpen: boolean;
  volume: number;
  muted: boolean;
  playbackRate: number;
  stableVolume: boolean;
  loop: boolean;
  autoPlay: boolean;
  ambientMode: boolean;
  /** Ambient glow follows the video live (no resample gap). */
  ambientSync?: boolean;
  /** Ambient glow size multiplier (1–2). */
  ambientSize?: number;
  /** Blurred poster + black letterbox behind the video. Off = transparent player shell. */
  playerBackground: boolean;
  /** Bars + seek strip stay visible when controls auto-hide */
  audioVisualizer: boolean;
  audioVisualizerStyle: 'bars' | 'mirror' | 'ribbon' | 'pulse' | 'line' | 'blocks' | 'dots' | 'aurora';
  /** Pop confetti from the visualizer on bass kicks (desktop). Intensity follows the audio. */
  visualizerConfetti: boolean;
  /** JSON map of stem type → enabled (kick/snare/hihat/bass/other). */
  stemConfettiInstruments: string;
  /** Video element scale-bounces on kick/bass hits (dance mode). */
  videoBounce: boolean;
  /** Bounce strength multiplier (0.25–2, 1 = default). */
  videoBounceIntensity: number;
  /** JSON map of stem type → the bounce reacts to it (kick/snare/hihat/bass/other). */
  videoBounceInstruments: string;
  quality: string;
  /** 8D / spatial audio master toggle. */
  spatialAudio: boolean;
  /** JSON-encoded `SpatialAudioConfig` (see `useSpatialAudio`). */
  spatialAudioConfig: string;
  /** Preferred caption language (BCP-47). Empty string = captions off. */
  captionLanguage: string;
};

export type PlayerSettingsPatch = Partial<PlayerSettings>;

export interface ContextProps {
  files: FileType[];
  setFiles: React.Dispatch<React.SetStateAction<FileType[]>>;
  isModalOpen: boolean;
  setIsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isLoading: boolean;
  initialLoading: boolean;
  /** True when the most recent feed fetch failed and we have nothing to show. */
  feedError: boolean;
  /** Re-attempt the initial feed load (clears feedError). */
  retryFeed: () => void;
  observerRef: React.RefObject<HTMLDivElement | null>;
  loadMoreVideos: () => void;
  clearFeedHistory: () => Promise<void>;
  user_agent: string;
  userId: string | null;
  userActions: { likedFileIds: Set<string>; dislikedFileIds: Set<string>; savedFileIds: Set<string> };
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
  hasFetchedImages: boolean;
  setHasFetchedImages: React.Dispatch<React.SetStateAction<boolean>>;
  /** Other signed-in accounts stored on this device (HttpOnly vault); excludes current session. */
  altAccounts: { id: string; username: string; profile_pic?: string | null }[];
  hideAppChrome: boolean;
  setHideAppChrome: React.Dispatch<React.SetStateAction<boolean>>;
  /** Encrypted HLS bootstrap from root (guest: token1 chain; user: token2 chain). */
  hlsBootstrap: string | null;
  hlsBootstrapRetry: string | null;
  /** In-memory reuse when browsing between watch pages (cleared on sign-out). */
  getDynamicSeriesPayloadCache: (fileSeriesId: string) => DynamicSeriesPayloadCache | null;
  setDynamicSeriesPayloadCache: (fileSeriesId: string, entry: DynamicSeriesPayloadCache) => void;
  getRelatedVideosPayloadCache: (fileId: string) => RelatedVideosPayloadCache | null;
  setRelatedVideosPayloadCache: (fileId: string, entry: RelatedVideosPayloadCache) => void;
}