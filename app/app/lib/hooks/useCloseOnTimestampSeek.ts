import { useEffect } from "react";
import { SEEK_TO_EVENT, type SeekToEventDetail } from "~/components/FormattedText";

/**
 * Closes a comments overlay when a timestamp inside it jumps the video.
 *
 * On a phone the comments cover the player, so tapping "1:30" seeks something
 * the reader cannot see and nothing appears to happen. The seek already travels
 * as a window event, so the overlay can simply listen for it and get out of the
 * way, which keeps the timestamp itself unaware of where it is being rendered.
 *
 * `fileId` guards against closing for a jump meant for a different video, which
 * a feed full of cards can easily produce.
 */
export function useCloseOnTimestampSeek(
  open: boolean,
  close: () => void,
  fileId?: string | null,
): void {
  useEffect(() => {
    if (!open) return;
    const onSeek = (e: Event) => {
      const detail = (e as CustomEvent<SeekToEventDetail>).detail;
      if (!detail) return;
      if (detail.fileId && fileId && detail.fileId !== fileId) return;
      close();
    };
    window.addEventListener(SEEK_TO_EVENT, onSeek);
    return () => window.removeEventListener(SEEK_TO_EVENT, onSeek);
  }, [open, close, fileId]);
}
