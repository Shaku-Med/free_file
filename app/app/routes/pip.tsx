import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import Hls from 'hls.js';
import { Play } from 'lucide-react';

const PIP_MESSAGE_ORIGIN = typeof window !== 'undefined' ? window.location.origin : '';

function isInPipWindow(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window.documentPictureInPicture && window.documentPictureInPicture.window === window);
}

function PipPlayer({ src, loop, startTime }: { src: string; loop: boolean; startTime: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    video.loop = loop;
    video.playsInline = true;
    video.muted = false;
    video.currentTime = startTime;

    const isHLS = src.includes('.m3u8');
    if (isHLS && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        capLevelToPlayerSize: true,
      });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);
      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }
    video.src = src;
    return () => {
      video.src = '';
    };
  }, [src, loop, startTime]);

  useEffect(() => {
    const notifyClose = () => {
      const video = videoRef.current;
      const t = video ? video.currentTime : 0;
      window.opener?.postMessage(
        { type: 'pip-closing', time: t, id: new URLSearchParams(window.location.search).get('id') },
        PIP_MESSAGE_ORIGIN
      );
    };
    window.addEventListener('beforeunload', notifyClose);
    return () => window.removeEventListener('beforeunload', notifyClose);
  }, []);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black flex flex-col justify-end cursor-pointer select-none"
      onClick={togglePlay}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === ' ' && (e.preventDefault(), togglePlay())}
      aria-label={playing ? 'Pause' : 'Play'}
    >
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-contain"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        playsInline
      />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          className={`w-16 h-16 rounded-full bg-black/50 flex items-center justify-center transition-opacity duration-200 ${playing ? 'opacity-0' : 'opacity-100'}`}
        >
          <Play className="w-8 h-8 text-white fill-white" />
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />
    </div>
  );
}

export default function PipRoute() {
  const [searchParams] = useSearchParams();
  const [inPip, setInPip] = useState(false);

  useEffect(() => {
    setInPip(isInPipWindow());
  }, []);

  const src = searchParams.get('src') || '';
  const id = searchParams.get('id') || '';
  const loop = searchParams.get('loop') === 'true';
  const t = Math.max(0, parseFloat(searchParams.get('t') || '0') || 0);

  if (!inPip) {
    return (
      <div className="min-h-screen bg-zinc-900 flex flex-col items-center justify-center p-6 text-center">
        <p className="text-white/90 text-lg font-medium">Picture-in-Picture only</p>
        <p className="text-white/60 text-sm mt-2 max-w-sm">
          This page is only available when opened from the video player. Play a video and click the
          PiP button to watch in a floating window.
        </p>
      </div>
    );
  }

  if (!src) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <p className="text-white/60 text-sm">No video source.</p>
      </div>
    );
  }

  return <PipPlayer src={src} loop={loop} startTime={t} />;
}
