import { useEffect, type RefObject } from "react"
import {
  ensureSharedGraph,
  resumeIfNeeded,
  setCompressorActive,
} from "~/lib/audio/sharedAudioGraph"

/**
 * Routes the video through a DynamicsCompressor + makeup gain when `enabled`. Coexists
 * with the spatial-audio engine and the analyser visualizer — they all share a single
 * `MediaElementAudioSource` (see `sharedAudioGraph`).
 */
export function useStableVolume(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const apply = () => {
      const v = videoRef.current
      if (!v) return
      const graph = ensureSharedGraph(v)
      if (!graph) return
      setCompressorActive(graph, enabled)
      if (enabled) void resumeIfNeeded(graph.ctx)
    }

    const onUserGesture = () => apply()
    const opts: AddEventListenerOptions = { capture: true, passive: true }
    const clickOpts: AddEventListenerOptions = { capture: true }
    document.addEventListener("touchstart", onUserGesture, opts)
    document.addEventListener("touchend", onUserGesture, opts)
    document.addEventListener("pointerdown", onUserGesture, clickOpts)
    document.addEventListener("click", onUserGesture, clickOpts)
    video.addEventListener("play", apply)
    video.addEventListener("loadedmetadata", apply)
    apply()

    return () => {
      document.removeEventListener("touchstart", onUserGesture, opts)
      document.removeEventListener("touchend", onUserGesture, opts)
      document.removeEventListener("pointerdown", onUserGesture, clickOpts)
      document.removeEventListener("click", onUserGesture, clickOpts)
      video.removeEventListener("play", apply)
      video.removeEventListener("loadedmetadata", apply)
      const v = videoRef.current
      if (v) {
        const graph = ensureSharedGraph(v)
        if (graph) setCompressorActive(graph, false)
      }
    }
  }, [enabled, videoRef])
}
