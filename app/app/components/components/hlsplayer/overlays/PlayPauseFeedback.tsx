import { Play, Pause } from '~/components/icons';

interface PlayPauseFeedbackProps {
  isPlaying: boolean;
  fading: boolean;
}

export default function PlayPauseFeedback({ isPlaying, fading }: PlayPauseFeedbackProps) {
  return (
    <div
      className={`absolute inset-0 z-20 flex items-center justify-center pointer-events-none transition-opacity duration-300 ${
        fading ? 'opacity-0' : 'opacity-100'
      }`}
      aria-hidden
    >
      <div className="rounded-full bg-black/50 backdrop-blur-sm p-5 flex items-center justify-center">
        {isPlaying ? (
          <Play className="w-16 h-16 text-white fill-white" />
        ) : (
          <Pause className="w-16 h-16 text-white fill-white" />
        )}
      </div>
    </div>
  );
}
