import { useEffect, useState, useCallback, useRef } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { usePlayerContext } from '../../PlayerContext';
import type { FileType } from '~/lib/types';
import VideoCard from '~/routes/Home/components/VideoCard';
import { useNavigate, useParams } from 'react-router';

interface EndScreenProps {
  suggestedVideos?: FileType[];
}

const emptyUserActions = { likedFileIds: new Set<string>(), dislikedFileIds: new Set<string>() };

// Track visited videos in session to avoid loops
const getVisitedVideos = (): Set<string> => {
  try {
    if (typeof sessionStorage === 'undefined') return new Set();
    const stored = sessionStorage.getItem('visited_videos');
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
};

const addVisitedVideo = (uniqueId: string) => {
  try {
    if (typeof sessionStorage === 'undefined') return;
    const visited = getVisitedVideos();
    visited.add(uniqueId);
    // Keep only last 50 to avoid memory issues
    const arr = Array.from(visited).slice(-50);
    sessionStorage.setItem('visited_videos', JSON.stringify(arr));
  } catch {}
};

export default function EndScreen({ suggestedVideos }: EndScreenProps) {
  const { state, replay, autoPlay } = usePlayerContext();
  const [countdown, setCountdown] = useState(5);
  const [autoplayActive, setAutoplayActive] = useState(true);
  const navigate = useNavigate();
  const params = useParams();
  const currentVideoId = params.id;
  const navigatingRef = useRef(false);

  // Filter out current video and recently visited videos
  const filteredVideos = (suggestedVideos || []).filter(video => {
    if (video.unique_id === currentVideoId) return false;
    const visited = getVisitedVideos();
    // Allow videos we haven't visited recently
    return !visited.has(video.unique_id);
  });

  // If all videos were visited, fall back to full list minus current
  const displayVideos = filteredVideos.length > 0 
    ? filteredVideos 
    : (suggestedVideos || []).filter(v => v.unique_id !== currentVideoId);

  const hasVideos = displayVideos.length > 0;
  const nextVideo = hasVideos ? displayVideos[0] : null;

  const handleCancelAutoplay = useCallback(() => {
    setAutoplayActive(false);
  }, []);

  const handleVideoSelect = useCallback((video: FileType) => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    setAutoplayActive(false);
    addVisitedVideo(video.unique_id);
    navigate(`/${video.unique_id}`);
  }, [navigate]);

  // Track current video as visited
  useEffect(() => {
    if (currentVideoId) {
      addVisitedVideo(currentVideoId);
    }
  }, [currentVideoId]);

  // Reset when video ends state changes
  useEffect(() => {
    if (!state.isEnded) {
      setCountdown(5);
      setAutoplayActive(true);
      navigatingRef.current = false;
    }
  }, [state.isEnded]);

  // Autoplay countdown timer
  useEffect(() => {
    if (!state.isEnded || !autoPlay || !autoplayActive || !nextVideo || navigatingRef.current) {
      return;
    }

    if (countdown <= 0) {
      handleVideoSelect(nextVideo);
      return;
    }

    const timer = setTimeout(() => {
      setCountdown(c => c - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [state.isEnded, autoPlay, autoplayActive, nextVideo, countdown, handleVideoSelect]);

  if (!state.isEnded) return null;

  return (
    <div className="absolute inset-0 z-40 bg-gradient-to-t from-black via-black/95 to-black/90 flex items-center justify-center overflow-hidden">
      <div className="w-full h-full flex flex-col md:flex-row items-center justify-center gap-6 p-4 md:p-8 max-w-5xl mx-auto">
        
        <div className="flex flex-col items-center gap-4 shrink-0">
          <button
            onClick={replay}
            className="group flex flex-col items-center gap-3"
          >
            <div className="w-20 h-20 rounded-full border-2 border-white/30 flex items-center justify-center group-hover:border-white/60 group-hover:bg-white/10 transition-all">
              <RotateCcw className="w-8 h-8 text-white" />
            </div>
            <span className="text-white text-sm font-medium">Replay</span>
          </button>
        </div>

        {hasVideos && (
          <div className="flex-1 min-w-0 max-w-xl w-full">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white/80 text-sm font-semibold uppercase tracking-wider">
                {autoPlay && autoplayActive && nextVideo ? 'Up Next' : 'Suggested'}
              </h3>
              {autoPlay && autoplayActive && nextVideo && (
                <div className="flex items-center gap-3">
                  <span className="text-white/50 text-xs">
                    Playing in {countdown}s
                  </span>
                  <button
                    onClick={handleCancelAutoplay}
                    className="text-white/60 hover:text-white text-xs flex items-center gap-1 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {autoPlay && autoplayActive && nextVideo && (
              <div 
                className="relative mb-2 rounded-xl overflow-hidden bg-white/5 border border-white/10 cursor-pointer"
                onClick={() => handleVideoSelect(nextVideo)}
              >
                <div className="absolute top-2 left-2 z-10 pointer-events-none">
                  <div className="relative w-10 h-10">
                    <svg className="w-10 h-10 -rotate-90" viewBox="0 0 40 40">
                      <circle
                        cx="20"
                        cy="20"
                        r="16"
                        fill="rgba(0,0,0,0.6)"
                        stroke="rgba(255,255,255,0.3)"
                        strokeWidth="3"
                      />
                      <circle
                        cx="20"
                        cy="20"
                        r="16"
                        fill="none"
                        stroke="white"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeDasharray={`${(countdown / 5) * 100.5} 100.5`}
                        className="transition-all duration-1000 ease-linear"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-white font-bold text-sm">{countdown}</span>
                    </div>
                  </div>
                </div>
                <div className="pointer-events-none">
                  <VideoCard
                    data={nextVideo}
                    index={0}
                    userActions={emptyUserActions}
                    layout="horizontal"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1 max-h-[45vh] overflow-y-auto pr-1 custom-scrollbar">
              {displayVideos.slice(autoPlay && autoplayActive ? 1 : 0, 8).map((video, index) => (
                <div 
                  key={video.id ?? video.unique_id}
                  className="cursor-pointer"
                  onClick={() => handleVideoSelect(video)}
                >
                  <div className="pointer-events-none">
                    <VideoCard
                      data={video}
                      index={index}
                      userActions={emptyUserActions}
                      layout="compact"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!hasVideos && (
          <div className="text-center">
            <p className="text-white/60 text-sm">No more videos to suggest</p>
          </div>
        )}
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 2px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }
      `}</style>
    </div>
  );
}