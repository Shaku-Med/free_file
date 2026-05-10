export function probeMediaDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("video/") && !file.type.startsWith("audio/")) {
      resolve(null)
      return
    }
    const url = URL.createObjectURL(file)
    const el =
      file.type.startsWith("audio/")
        ? document.createElement("audio")
        : document.createElement("video")
    let settled = false
    const finish = (value: number | null) => {
      if (settled) return
      settled = true
      URL.revokeObjectURL(url)
      el.removeAttribute("src")
      el.load()
      resolve(value)
    }
    el.preload = "metadata"
    if (el instanceof HTMLVideoElement) {
      el.muted = true
      el.playsInline = true
    }
    el.addEventListener(
      "loadedmetadata",
      () => {
        const d = el.duration
        finish(Number.isFinite(d) && d > 0 ? d : null)
      },
      { once: true },
    )
    el.addEventListener("error", () => finish(null), { once: true })
    el.src = url
    el.load()
    setTimeout(() => finish(null), 8000)
  })
}
