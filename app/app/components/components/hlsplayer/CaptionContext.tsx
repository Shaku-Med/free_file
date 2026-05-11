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

export interface CaptionLanguage {
  code: string
  label: string
  path: string
}

export type CaptionFontSize = "sm" | "md" | "lg" | "xl"

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
  backgroundOpacity: number
  setBackgroundOpacity: (opacity: number) => void
}

export const CAPTION_CONTROLS_FLOOR_PCT = 16
export const CAPTION_DEFAULT_Y_PCT = 20
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
    /* quota / private mode — ignore */
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
  const { userId, playerSettings, savePlayerSettings } = useFileContext()
  const preferredLanguage = playerSettings?.captionLanguage || ""
  const languages = useMemo(
    () => (userId ? extractLanguages(file) : []),
    [file, userId],
  )
  const fileKey = file?.unique_id || file?.id || ""

  const [currentLanguage, setCurrentLanguageState] = useState<string | null>(null)
  const [cuesByLang, setCuesByLang] = useState<Record<string, CaptionCue[]>>({})
  const [loadingLang, setLoadingLang] = useState<string | null>(null)
  const [errorLang, setErrorLang] = useState<string | null>(null)
  const [currentCue, setCurrentCue] = useState("")

  const [position, setPositionState] = useState<CaptionPosition>(() =>
    readJSON<CaptionPosition>(POSITION_KEY, DEFAULT_POSITION),
  )
  const [styleState, setStyleState] = useState<{ fontSize: CaptionFontSize; backgroundOpacity: number }>(() =>
    readJSON(STYLE_KEY, { fontSize: "md" as CaptionFontSize, backgroundOpacity: 0.7 }),
  )

  /**
   * On every file change, clear the per-file cache and pick the language to display:
   * if the user's preferred default exists on this file, auto-select it; otherwise stay off
   * (the user can flip it on manually for this video). This mirrors how the rest of the
   * player handles per-file state (thumbnail preview, intro markers, etc.).
   */
  useEffect(() => {
    setCuesByLang({})
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
      setCurrentLanguageState(code)
      void savePlayerSettings({ captionLanguage: code ?? "" }).catch(() => {})
    },
    [savePlayerSettings],
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
        setCuesByLang((prev) => ({ ...prev, [language]: parsed.cues }))
      } catch {
        if (gen === generationRef.current) setErrorLang(language)
      } finally {
        inflightRef.current.delete(language)
        setLoadingLang((prev) => (prev === language ? null : prev))
      }
    },
    [file?.id, file?.unique_id, userId],
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
      backgroundOpacity: 0.7,
      setBackgroundOpacity: () => {},
    }
  }
  return ctx
}
