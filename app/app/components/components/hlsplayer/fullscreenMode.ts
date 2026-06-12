import { isAndroid, isIOS } from 'react-device-detect';

type VideoWithWebkitFs = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

/** Android Chrome: fullscreen the <video> and restore native controls. */
export function shouldGrantNativeVideoControls(): boolean {
  return isAndroid;
}

/** Enter fullscreen on the correct element for this device. */
export async function enterPlayerFullscreen(
  video: HTMLVideoElement | null,
  container: HTMLElement | null,
): Promise<void> {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return;
  }
  if (!video && !container) return;

  if (isAndroid && video) {
    await video.requestFullscreen();
    return;
  }

  if (isIOS && video) {
    const v = video as VideoWithWebkitFs;
    if (typeof v.webkitEnterFullscreen === 'function') {
      v.webkitEnterFullscreen();
      return;
    }
  }

  if (container) {
    await container.requestFullscreen();
    return;
  }

  if (video) {
    await video.requestFullscreen();
  }
}

/** Sync native-control CSS after the browser enters/exits fullscreen. */
export function syncNativeVideoControls(video: HTMLVideoElement | null): void {
  if (!video) return;
  const grant =
    shouldGrantNativeVideoControls() && document.fullscreenElement === video;
  if (grant) {
    video.classList.add('native-controls-allowed');
    video.controls = true;
  } else {
    video.classList.remove('native-controls-allowed');
    video.controls = false;
  }
}
