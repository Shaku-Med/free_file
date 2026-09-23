/**
 * Which file the shared `<video>` actually holds media for.
 *
 * The global player keeps one element mounted across watch navigations, so for
 * the first frames after a route swap it still reports the PREVIOUS file's
 * videoWidth/videoHeight. Anything sizing itself from the element has to know
 * whether those numbers describe the file it is rendering, so the engine stamps
 * the element as it attaches media and readers compare the stamp first.
 */

export function markLoadedMedia(
  video: HTMLVideoElement,
  fileId: string | null | undefined,
): void {
  if (fileId) video.dataset.loadedMedia = fileId;
  else delete video.dataset.loadedMedia;
}

export function loadedMediaFile(video: HTMLVideoElement): string | null {
  return video.dataset.loadedMedia || null;
}
