import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import type { FileType } from "~/lib/types"
import {
  findLanguageLabel,
  normalizeCaptionEntries,
  parseVTT,
  type CaptionCue,
} from "~/lib/captions/vtt"
import { useFileContext } from "~/lib/Context/Context"

const vttCache = new Map<string, CaptionCue[]>()

export interface CaptionLanguage {
  code: string
  label: string
  path: string
}

export type CaptionFontSize = "sm" | "md" | "lg" | "xl"
export type CaptionTextAlign = "left" | "center" | "right"

export interface CaptionPosition {
  xPct: number
  yBottomPct: number
}

interface CaptionContextValue {
  languages: CaptionLanguage[]
  currentLanguage: string | null
  setCurrentLanguage: (code: string | null) => void
  prefetchLanguage: (code: string | null | undefined) => void
  currentCue: string
  isLoading: boolean
  hasError: boolean
  position: CaptionPosition
  setPosition: (pos: CaptionPosition) => void
  resetPosition: () => void
  fontSize: CaptionFontSize
  setFontSize: (size: CaptionFontSize) => void
  textAlign: CaptionTextAlign
  setTextAlign: (align: CaptionTextAlign) => void
  backgroundOpacity: number
  setBackgroundOpacity: (opacity: number) => void
}

export const CAPTION_CONTROLS_FLOOR_PCT = 14
export const CAPTION_DEFAULT_Y_PCT = 3
const DEFAULT_POSITION: CaptionPosition = { xPct: 50, yBottomPct: CAPTION_DEFAULT_Y_PCT }
const POSITION_KEY = "hls-caption-position"
const STYLE_KEY = "hls-caption-style"

const CaptionContext = createContext<CaptionContextValue | null>(null)

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? { ...fallback, ...parsed } : fallback
  } catch {
    return fallback
  }
}

function writeJSON(key: string, value: unknown) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota / private mode  ignore */
  }
}

function extractLanguages(file: FileType | null): CaptionLanguage[] {
  const entries = normalizeCaptionEntries(file?.captions)
  return entries.map((entry) => ({
    code: entry.language,
    label: findLanguageLabel(entry.language),
    path: entry.path,
  }))
}

function findActiveCue(cues: CaptionCue[], time: number): CaptionCue | null {
  if (!cues.length) return null
  let lo = 0
  let hi = cues.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const cue = cues[mid]
    if (time < cue.start) hi = mid - 1
    else if (time >= cue.end) lo = mid + 1
    else return cue
  }
  return null
}

interface CaptionProviderProps {
  children: ReactNode
  file: FileType | null
  videoRef: React.RefObject<HTMLVideoElement | null>
}

export function CaptionProvider({ children, file, videoRef }: CaptionProviderProps) {
  const { userId, playerSettings, setPlayerSettings, savePlayerSettings } = useFileContext()
  const preferredLanguage = playerSettings?.captionLanguage || ""
  const languagesRaw = useMemo(
    () => (userId ? extractLanguages(file) : []),
    [file, userId],
  )
  const languagesRef = useRef<CaptionLanguage[]>([])
  const languages = useMemo(() => {
    const prev = languagesRef.current
    if (
      prev.length === languagesRaw.length &&
      prev.every((l, i) => l.code === languagesRaw[i].code && l.path === languagesRaw[i].path)
    ) {
      return prev
    }
    languagesRef.current = languagesRaw
    return languagesRaw
  }, [languagesRaw])

  const fileKey = file?.unique_id || file?.id || ""

  const [currentLanguage, setCurrentLanguageState] = useState<string | null>(null)
  const [cuesByLang, setCuesByLang] = useState<Record<string, CaptionCue[]>>({})
  const [loadingLang, setLoadingLang] = useState<string | null>(null)
  const [errorLang, setErrorLang] = useState<string | null>(null)
  const [currentCue, setCurrentCue] = useState("")

  const [position, setPositionState] = useState<CaptionPosition>(() =>
    readJSON<CaptionPosition>(POSITION_KEY, DEFAULT_POSITION),
  )
  const [styleState, setStyleState] = useState<{ fontSize: CaptionFontSize; textAlign: CaptionTextAlign; backgroundOpacity: number }>(() =>
    readJSON(STYLE_KEY, { fontSize: "md" as CaptionFontSize, textAlign: "center" as CaptionTextAlign, backgroundOpacity: 0.7 }),
  )

  /**
   * On every file change, restore cached cues for this file and pick the language to display:
   * if the user's preferred default exists on this file, auto-select it; otherwise stay off.
   */
  useEffect(() => {
    const restored: Record<string, CaptionCue[]> = {}
    for (const lang of languages) {
      const cached = vttCache.get(`${fileKey}:${lang.code}`)
      if (cached) restored[lang.code] = cached
    }
    setCuesByLang(restored)
    setErrorLang(null)
    setLoadingLang(null)
    setCurrentCue("")
    if (preferredLanguage && languages.some((l) => l.code === preferredLanguage)) {
      setCurrentLanguageState(preferredLanguage)
    } else {
      setCurrentLanguageState(null)
    }
  }, [fileKey, languages, preferredLanguage])

  const setCurrentLanguage = useCallback(
    (code: string | null) => {
      const next = code ?? ""
      setCurrentLanguageState(code)
      // Update the FileContext copy of playerSettings synchronously so the *next* video
      // navigation sees `preferredLanguage` = the user's most recent pick. Without this,
      // we'd only ever read the value the root loader saw on the original page load.
      setPlayerSettings((prev) => (prev ? { ...prev, captionLanguage: next } : prev))
      void savePlayerSettings({ captionLanguage: next }).catch(() => {})
    },
    [savePlayerSettings, setPlayerSettings],
  )

  const setPosition = useCallback((pos: CaptionPosition) => {
    setPositionState(pos)
    writeJSON(POSITION_KEY, pos)
  }, [])

  const resetPosition = useCallback(() => {
    setPositionState(DEFAULT_POSITION)
    writeJSON(POSITION_KEY, DEFAULT_POSITION)
  }, [])

  const setFontSize = useCallback((size: CaptionFontSize) => {
    setStyleState((prev) => {
      const next = { ...prev, fontSize: size }
      writeJSON(STYLE_KEY, next)
      return next
    })
  }, [])

  const setTextAlign = useCallback((align: CaptionTextAlign) => {
    setStyleState((prev) => {
      const next = { ...prev, textAlign: align }
      writeJSON(STYLE_KEY, next)
      return next
    })
  }, [])

  const setBackgroundOpacity = useCallback((opacity: number) => {
    setStyleState((prev) => {
      const clamped = Math.max(0, Math.min(1, opacity))
      const next = { ...prev, backgroundOpacity: clamped }
      writeJSON(STYLE_KEY, next)
      return next
    })
  }, [])

  const cuesRef = useRef<Record<string, CaptionCue[]>>({})
  useEffect(() => {
    cuesRef.current = cuesByLang
  }, [cuesByLang])

  const inflightRef = useRef<Set<string>>(new Set())
  const generationRef = useRef(0)

  useEffect(() => {
    generationRef.current += 1
    inflightRef.current = new Set()
  }, [fileKey])

  const loadVtt = useCallback(
    async (language: string) => {
      if (!language || !userId) return
      if (cuesRef.current[language]) return
      if (inflightRef.current.has(language)) return
      const uniqueId = typeof file?.unique_id === "string" ? file.unique_id : ""
      const fileId = typeof file?.id === "string" ? file.id : ""
      const lookup = uniqueId || fileId
      if (!lookup) return
      const cacheKey = `${fileKey}:${language}`
      const cached = vttCache.get(cacheKey)
      if (cached) {
        setCuesByLang((prev) => ({ ...prev, [language]: cached }))
        return
      }
      const gen = generationRef.current
      inflightRef.current.add(language)
      setLoadingLang((prev) => prev ?? language)
      setErrorLang(null)
      try {
        const prepRes = await fetch("/api/captions/load-prepare", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            uniqueId
              ? { unique_id: uniqueId, language }
              : { file_id: fileId, language },
          ),
        })
        if (!prepRes.ok) throw new Error(`prep ${prepRes.status}`)
        const prep = (await prepRes.json()) as { token?: string; path?: string }
        if (!prep?.token || !prep?.path) throw new Error("bad prep response")

        const vttRes = await fetch(`/api/load/vtt/${prep.path}`, {
          credentials: "include",
          headers: { "X-Caption-Token": prep.token },
        })
        if (!vttRes.ok) throw new Error(`load ${vttRes.status}`)
        const text = await vttRes.text()
        const parsed = parseVTT(text)
        if (gen !== generationRef.current) return
        vttCache.set(cacheKey, parsed.cues)
        setCuesByLang((prev) => ({ ...prev, [language]: parsed.cues }))
      } catch {
        if (gen === generationRef.current) setErrorLang(language)
      } finally {
        inflightRef.current.delete(language)
        setLoadingLang((prev) => (prev === language ? null : prev))
      }
    },
    [file?.id, file?.unique_id, fileKey, userId],
  )

  useEffect(() => {
    if (!currentLanguage) return
    void loadVtt(currentLanguage)
  }, [currentLanguage, loadVtt])

  const prefetchLanguage = useCallback(
    (language: string | null | undefined) => {
      if (!language) return
      void loadVtt(language)
    },
    [loadVtt],
  )

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (!currentLanguage) {
      setCurrentCue("")
      return
    }
    const cues = cuesByLang[currentLanguage]
    if (!cues || cues.length === 0) {
      setCurrentCue("")
      return
    }
    let last = ""
    const update = () => {
      const cue = findActiveCue(cues, video.currentTime)
      const text = cue?.text || ""
      if (text !== last) {
        last = text
        setCurrentCue(text)
      }
    }
    update()
    video.addEventListener("timeupdate", update)
    video.addEventListener("seeked", update)
    video.addEventListener("ratechange", update)
    return () => {
      video.removeEventListener("timeupdate", update)
      video.removeEventListener("seeked", update)
      video.removeEventListener("ratechange", update)
    }
  }, [videoRef, currentLanguage, cuesByLang])

  /**
   * Mirror caption cues into the native `<video>` element's TextTracks.
   *
   * Why: iOS Safari's native fullscreen player has no idea about our
   * React caption overlay  the overlay is hidden behind iOS's own
   * video chrome. When the user taps fullscreen on a phone they get
   * Apple's native player. Native players show a CC button if (and
   * only if) the `<video>` has TextTracks attached.
   *
   * Strategy:
   *   - Maintain one TextTrack per language. Cues get added once and
   *     reused for the lifetime of the video element.
   *   - Default `mode = 'hidden'` so our React overlay owns rendering
   *     in normal (non-fullscreen) mode without double-displaying.
   *   - On fullscreen enter (covers both W3C `fullscreenchange` and
   *     iOS-specific `webkitbeginfullscreen` on the video element),
   *     flip the active language to `'showing'` so native captions
   *     render inside Apple's player. Restore to `'hidden'` on exit.
   *   - If the user clicks the iOS CC button itself we don't fight it 
   *     iOS may flip modes to `'disabled'` and that just means "no
   *     captions" in native UI, which is fine.
   */
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (languages.length === 0) return

    // Map of language code → its native TextTrack on this video.
    const trackMap = new Map<string, TextTrack>()

    for (const lang of languages) {
      // Reuse a track for this language if we already added one (e.g. when
      // the user toggles between langs without remounting the video).
      let track: TextTrack | undefined
      for (let i = 0; i < video.textTracks.length; i++) {
        const t = video.textTracks[i]
        if (t.language === lang.code && t.label === lang.label) {
          track = t
          break
        }
      }
      if (!track) {
        track = video.addTextTrack("captions", lang.label, lang.code)
      }
      trackMap.set(lang.code, track)

      const cues = cuesByLang[lang.code]
      if (!cues || cues.length === 0) continue
      // Only refill if the cue count differs  addCue is idempotent-ish
      // but VTTCue creation is non-trivial when the cue list is huge.
      if ((track.cues?.length ?? 0) === cues.length) continue
      // Clear and re-add to keep it in sync.
      if (track.cues) {
        while (track.cues.length > 0) {
          track.removeCue(track.cues[0])
        }
      }
      for (const cue of cues) {
        try {
          track.addCue(new VTTCue(cue.start, cue.end, cue.text))
        } catch {
          /* malformed cue  skip silently */
        }
      }
    }

    // Find the track for the active language, if any.
    const activeTrack = currentLanguage ? trackMap.get(currentLanguage) ?? null : null

    // Default: all tracks hidden (our React overlay owns non-fullscreen
    // rendering). Tracks for non-active languages get `disabled` so iOS
    // doesn't list them as "off-by-default but available"  only the
    // chosen language shows up as the togglable one.
    for (const [code, t] of trackMap) {
      if (code === currentLanguage) {
        t.mode = "hidden"
      } else {
        t.mode = "disabled"
      }
    }

    // Native captions are ONLY needed when our React overlay can't be seen
    // i.e. iOS Safari's native video player (`webkitDisplayingFullscreen`),
    // which replaces the page with Apple's own chrome and hides the overlay.
    //
    // Desktop (and Android) fullscreen the player CONTAINER via the W3C
    // fullscreen API, so our overlay is still in the DOM and renders normally.
    // Flipping the native track to 'showing' there made BOTH render at once
    // the double-caption bug. So we key off native-video-fullscreen only and
    // keep the track 'hidden' for document/element fullscreen.
    const isNativeVideoFullscreen = () => {
      const v = video as HTMLVideoElement & { webkitDisplayingFullscreen?: boolean }
      return Boolean(v.webkitDisplayingFullscreen)
    }

    const syncMode = () => {
      if (!activeTrack) return
      activeTrack.mode = isNativeVideoFullscreen() ? "showing" : "hidden"
    }
    syncMode()

    document.addEventListener("fullscreenchange", syncMode)
    document.addEventListener("webkitfullscreenchange", syncMode as EventListener)
    video.addEventListener("webkitbeginfullscreen", syncMode)
    video.addEventListener("webkitendfullscreen", syncMode)

    return () => {
      document.removeEventListener("fullscreenchange", syncMode)
      document.removeEventListener("webkitfullscreenchange", syncMode as EventListener)
      video.removeEventListener("webkitbeginfullscreen", syncMode)
      video.removeEventListener("webkitendfullscreen", syncMode)
      // Don't destroy tracks on cleanup  keeping them lets a fast
      // language toggle reuse the loaded cues without refetching.
    }
  }, [videoRef, languages, cuesByLang, currentLanguage])

  const value = useMemo<CaptionContextValue>(
    () => ({
      languages,
      currentLanguage,
      setCurrentLanguage,
      prefetchLanguage,
      currentCue,
      isLoading: loadingLang !== null && loadingLang === currentLanguage,
      hasError: errorLang !== null && errorLang === currentLanguage,
      position,
      setPosition,
      resetPosition,
      fontSize: styleState.fontSize,
      setFontSize,
      textAlign: styleState.textAlign,
      setTextAlign,
      backgroundOpacity: styleState.backgroundOpacity,
      setBackgroundOpacity,
    }),
    [
      languages,
      currentLanguage,
      setCurrentLanguage,
      prefetchLanguage,
      currentCue,
      loadingLang,
      errorLang,
      position,
      setPosition,
      resetPosition,
      styleState.fontSize,
      setFontSize,
      styleState.textAlign,
      setTextAlign,
      styleState.backgroundOpacity,
      setBackgroundOpacity,
    ],
  )

  return <CaptionContext.Provider value={value}>{children}</CaptionContext.Provider>
}

export function useCaptionContext(): CaptionContextValue {
  const ctx = useContext(CaptionContext)
  if (!ctx) {
    return {
      languages: [],
      currentLanguage: null,
      setCurrentLanguage: () => {},
      prefetchLanguage: () => {},
      currentCue: "",
      isLoading: false,
      hasError: false,
      position: DEFAULT_POSITION,
      setPosition: () => {},
      resetPosition: () => {},
      fontSize: "md",
      setFontSize: () => {},
      textAlign: "center",
      setTextAlign: () => {},
      backgroundOpacity: 0.7,
      setBackgroundOpacity: () => {},
    }
  }
  return ctx
}
