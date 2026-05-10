import { useEffect, useState } from "react"

let cached: boolean | null = null

function probeHardwareAcceleration(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return true
  if (cached !== null) return cached
  try {
    const canvas = document.createElement("canvas")
    const opts: WebGLContextAttributes = { failIfMajorPerformanceCaveat: true }
    const gl =
      (canvas.getContext("webgl2", opts) as WebGL2RenderingContext | null) ||
      (canvas.getContext("webgl", opts) as WebGLRenderingContext | null) ||
      (canvas.getContext("experimental-webgl", opts) as WebGLRenderingContext | null)
    if (!gl) {
      cached = false
      return false
    }
    const dbgInfo = gl.getExtension("WEBGL_debug_renderer_info")
    const renderer =
      dbgInfo && typeof gl.getParameter === "function"
        ? String(gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL) || "").toLowerCase()
        : ""
    const looksSoftware =
      renderer.includes("swiftshader") ||
      renderer.includes("software") ||
      renderer.includes("llvmpipe") ||
      renderer.includes("microsoft basic render") ||
      renderer.includes("ansgl")
    cached = !looksSoftware
    return cached
  } catch {
    cached = false
    return false
  }
}

/**
 * Returns `true` when the browser appears to have GPU-backed compositing,
 * `false` when hardware acceleration is disabled or only software WebGL is
 * available. SSR-safe: returns `true` on first render, then resolves on client.
 *
 * Components that rely on CSS `filter`/`backdrop-filter`/`mix-blend-mode` for
 * heavy effects should check this and serve a cheaper fallback when `false`.
 */
export function useHardwareAcceleration(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() =>
    typeof window === "undefined" ? true : probeHardwareAcceleration(),
  )
  useEffect(() => {
    const v = probeHardwareAcceleration()
    setEnabled((prev) => (prev === v ? prev : v))
  }, [])
  return enabled
}
