import React, { useState } from 'react';
import { Play, Pause, SkipForward, SkipBack, Volume2, VolumeX, Maximize2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Slider } from '../ui/slider';

interface BottomPlayerProps {
  title?: string;
  artist?: string;
  thumbnail?: string;
  src?: string;
  isPlaying?: boolean;
  onPlayPause?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onVolumeChange?: (volume: number) => void;
  onSeek?: (time: number) => void;
  currentTime?: number;
  duration?: number;
  volume?: number;
}

const BottomPlayer: React.FC<BottomPlayerProps> = ({
  title = 'No track selected',
  artist = 'Unknown artist',
  thumbnail,
  src,
  isPlaying = false,
  onPlayPause,
  onNext,
  onPrevious,
  onVolumeChange,
  onSeek,
  currentTime = 0,
  duration = 0,
  volume = 1,
}) => {
  const [isMuted, setIsMuted] = useState(false);
  const [localVolume, setLocalVolume] = useState(volume);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0];
    setLocalVolume(newVolume);
    setIsMuted(newVolume === 0);
    onVolumeChange?.(newVolume);
  };

  const toggleMute = () => {
    if (isMuted) {
      setLocalVolume(0.5);
      setIsMuted(false);
      onVolumeChange?.(0.5);
    } else {
      setLocalVolume(0);
      setIsMuted(true);
      onVolumeChange?.(0);
    }
  };

  const handleSeek = (value: number[]) => {
    onSeek?.(value[0]);
  };

  return (
    <div className={` w-full min-h-fit`}>
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center gap-4">
          {/* Thumbnail and Track Info */}
          <div className="flex items-center gap-3 min-w-0 flex-shrink-0">
            {thumbnail ? (
              <img
                src={thumbnail}
                alt={title}
                className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-14 h-14 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                <Play className="w-6 h-6 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{title}</p>
              <p className="text-xs text-muted-foreground truncate">{artist}</p>
            </div>
          </div>

          {/* Playback Controls */}
          <div className="flex-1 flex flex-col items-center gap-2 min-w-0">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onPrevious}
                disabled={!onPrevious}
              >
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button
                variant="default"
                size="icon"
                className="h-10 w-10 rounded-full"
                onClick={onPlayPause}
              >
                {isPlaying ? (
                  <Pause className="h-5 w-5" />
                ) : (
                  <Play className="h-5 w-5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onNext}
                disabled={!onNext}
              >
                <SkipForward className="h-4 w-4" />
              </Button>
            </div>
            {/* Progress Bar */}
            <div className="flex items-center gap-2 w-full max-w-md">
              <span className="text-xs text-muted-foreground w-10 text-right">
                {formatTime(currentTime)}
              </span>
              <Slider
                value={[currentTime]}
                max={duration || 100}
                step={1}
                onValueChange={handleSeek}
                className="flex-1"
              />
              <span className="text-xs text-muted-foreground w-10">
                {formatTime(duration)}
              </span>
            </div>
          </div>

          {/* Volume and Additional Controls */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={toggleMute}
            >
              {isMuted || localVolume === 0 ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </Button>
            <div className="w-24">
              <Slider
                value={[localVolume * 100]}
                max={100}
                step={1}
                onValueChange={(value) => handleVolumeChange([value[0] / 100])}
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BottomPlayer;
