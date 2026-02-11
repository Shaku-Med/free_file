import { RotateCcw } from 'lucide-react';
import { usePlayerContext } from '../../PlayerContext';
import type { FileType } from '~/lib/types';
import VideoCard from '~/routes/Home/components/VideoCard';

interface EndScreenProps {
  suggestedVideos?: FileType[];
  onVideoSelect?: (video: FileType) => void;
}

const emptyUserActions = { likedFileIds: new Set<string>(), dislikedFileIds: new Set<string>() };

export default function EndScreen({ suggestedVideos }: EndScreenProps) {
  const { state, replay } = usePlayerContext();

  if (!state.isEnded) return null;

  const hasVideos = suggestedVideos && suggestedVideos.length > 0;

  return (
    <div className="absolute inset-0 z-40 bg-black/85 backdrop-blur-sm flex flex-col min-h-0 overflow-hidden">
      <div className="flex flex-col items-center gap-4 w-full max-w-3xl mx-auto px-4 py-4 flex-shrink-0">
        <button
          onClick={replay}
          className="flex flex-col items-center gap-2 group"
        >
          <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-white/20 transition-colors">
            <RotateCcw className="w-7 h-7 text-white" />
          </div>
          <span className="text-white text-sm font-medium">Replay</span>
        </button>
        {hasVideos && (
          <h3 className="text-white/70 text-xs font-medium uppercase tracking-wider">
            Up next
          </h3>
        )}
      </div>

      {hasVideos && (
        <div className="flex-1 min-h-0 overflow-y-auto w-full px-4 pb-4">
          <div className="grid grid-cols-2 gap-3 w-full max-w-3xl mx-auto">
            {suggestedVideos!.slice(0, 8).map((video, index) => (
              <VideoCard
                key={video.id ?? video.unique_id}
                data={video}
                index={index}
                userActions={emptyUserActions}
                related
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
