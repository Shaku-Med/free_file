import { Cast } from 'lucide-react';
import { usePlayerContext } from '../../PlayerContext';
import { useRemotePlayback } from '../../hooks/useRemotePlayback';

export default function CastButton() {
  const { videoRef } = usePlayerContext();
  const { isAvailable, prompt } = useRemotePlayback(videoRef);

  if (!isAvailable) return null;

  return (
    <button
      onClick={prompt}
      className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-white"
      aria-label="Cast to device"
      title="Cast to TV or other device"
    >
      <Cast className="w-5 h-5" />
    </button>
  );
}
