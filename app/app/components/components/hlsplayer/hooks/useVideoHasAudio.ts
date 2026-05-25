import { useEffect, useState, type RefObject } from 'react';
import Hls from 'hls.js';

type HlsLike = {
  levels?: Array<{
    audioCodec?: string;
    attrs?: { CODECS?: string };
  }>;
  audioTracks?: unknown[];
};

function levelSuggestsAudio(level: { audioCodec?: string; attrs?: { CODECS?: string } }): boolean {
  const codecs = String(level.attrs?.CODECS ?? '');
  if (/mp4a\.|mp4a |aac|ac-3|ec-3|opus|vorbis|flac|alac/i.test(codecs)) return true;
  const ac = level.audioCodec;
  return Boolean(ac && ac !== 'none');
}

/** When we can tell from manifest / element; otherwise null (keep optimistic true). */
function inferHasAudio(video: HTMLVideoElement, hls: HlsLike | null): boolean | null {
  const moz = (video as HTMLVideoElement & { mozHasAudio?: boolean }).mozHasAudio;
  if (moz === false) return false;
  if (moz === true) return true;

  const at = (video as HTMLVideoElement & { audioTracks?: { length: number } }).audioTracks;
  if (at && typeof at.length === 'number' && at.length > 0) return true;

  const wk = (video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount;
  if (typeof wk === 'number' && wk > 0) return true;

  if (hls?.levels?.length) {
    if (Array.isArray(hls.audioTracks) && hls.audioTracks.length > 0) return true;
    if (hls.levels.some((l) => levelSuggestsAudio(l))) return true;
    const allHaveCodecs = hls.levels.every((l) => String(l.attrs?.CODECS ?? '').length > 0);
    if (allHaveCodecs && hls.levels.every((l) => !levelSuggestsAudio(l))) return false;
  }

  return null;
}

/**
 * Best-effort: disable volume UI when the stream clearly has no audio.
 * Defaults to true until we detect otherwise (avoids hiding controls on unknown browsers).
 *
 * `serverHint` is the authoritative `has_audio` flag from the upload pipeline
 * (computed from waveform peak amplitudes). When the server says the track
 * is silent we believe it  covers the "audio stream exists but it's all
 * silence" case (recording with mic muted, stock footage with empty track)
 * which the stream-level detection above can't catch.
 */
export function useVideoHasAudio(
  videoRef: RefObject<HTMLVideoElement | null>,
  hlsRef: RefObject<Hls | null>,
  src: string,
  serverHint?: boolean | null
): boolean {
  // If the server explicitly told us there's no audio, short-circuit. The
  // runtime detection below would still report true (a silent AAC stream
  // is still an audio stream) so we'd never disable the button without
  // this override.
  const earlyOut = serverHint === false;
  const [hasAudio, setHasAudio] = useState(!earlyOut);

  useEffect(() => {
    if (earlyOut) {
      setHasAudio(false);
      return;
    }
    setHasAudio(true);
    const video = videoRef.current;
    if (!video || !src) return;

    let hlsCleanup: (() => void) | undefined;
    let poller: ReturnType<typeof setInterval> | null = null;
    let pollStop: ReturnType<typeof setTimeout> | null = null;

    const apply = () => {
      const hls = hlsRef.current as HlsLike | null;
      const next = inferHasAudio(video, hls);
      if (next !== null) setHasAudio(next);

      const h = hlsRef.current;
      if (h && !hlsCleanup) {
        const handler = () => {
          const n = inferHasAudio(video, hlsRef.current as HlsLike | null);
          if (n !== null) setHasAudio(n);
        };
        h.on(Hls.Events.MANIFEST_PARSED, handler);
        h.on(Hls.Events.LEVEL_LOADED, handler);
        hlsCleanup = () => {
          h.off(Hls.Events.MANIFEST_PARSED, handler);
          h.off(Hls.Events.LEVEL_LOADED, handler);
        };
      }
    };

    apply();

    const onMeta = () => apply();
    const onPlaying = () => apply();
    let lastT = 0;
    const onTime = () => {
      const now = Date.now();
      if (now - lastT < 400) return;
      lastT = now;
      apply();
    };

    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('timeupdate', onTime);

    poller = setInterval(apply, 350);
    pollStop = setTimeout(() => {
      if (poller) clearInterval(poller);
      poller = null;
    }, 6000);

    return () => {
      hlsCleanup?.();
      if (poller) clearInterval(poller);
      if (pollStop) clearTimeout(pollStop);
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('timeupdate', onTime);
    };
  }, [src, videoRef, hlsRef, earlyOut]);

  return hasAudio;
}
