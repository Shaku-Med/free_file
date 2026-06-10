import { useEffect, useMemo, useState } from "react"
import { ChevronLeft, Globe, Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import {
  SUPPORTED_LANGUAGES,
  findLanguageLabel,
  isValidLanguageCode,
  normalizeCaptionEntries,
  parseVTT,
  serializeVTT,
  validateTrack,
} from "~/lib/captions/vtt"
import type { CaptionCue, CaptionEntry, CaptionTrack } from "~/lib/captions/vtt"
export type { CaptionEntry } from "~/lib/captions/vtt"
import { probeMediaDuration } from "~/lib/captions/duration"
import { useFileContext } from "~/lib/Context/Context"
import { fetchUploadAuthContext } from "~/lib/uploadAuth.client"
import { CaptionEditor } from "./CaptionEditor"

type View = "list" | "language" | "editor"

interface CaptionModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fileId: string
  initialCaptions: CaptionEntry[]
  duration?: number
  mediaFile?: File
  disabled?: boolean
  onCaptionsChange?: (captions: CaptionEntry[]) => void
}

export function CaptionModal({
  open,
  onOpenChange,
  fileId,
  initialCaptions,
  duration,
  mediaFile,
  disabled,
  onCaptionsChange,
}: CaptionModalProps) {
  const { uploadServerUrl } = useFileContext()
  const [view, setView] = useState<View>("list")
  const [captions, setCaptions] = useState<CaptionEntry[]>(() => normalizeCaptionEntries(initialCaptions))
  const [draft, setDraft] = useState<CaptionTrack | null>(null)
  const [draftLanguageOriginal, setDraftLanguageOriginal] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [customCode, setCustomCode] = useState("")
  const [search, setSearch] = useState("")
  const [probedDuration, setProbedDuration] = useState<number | null>(null)
  const [probing, setProbing] = useState(false)
  const [loadingLanguage, setLoadingLanguage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const effectiveDuration = useMemo(() => {
    if (Number.isFinite(duration) && (duration as number) > 0) return duration as number
    if (probedDuration && probedDuration > 0) return probedDuration
    return 0
  }, [duration, probedDuration])

  useEffect(() => {
    if (!open) {
      setView("list")
      setDraft(null)
      setDraftLanguageOriginal(null)
      setError(null)
      setCustomCode("")
      setSearch("")
      setLoadingLanguage(null)
      setSaving(false)
      setDeleting(null)
    } else {
      setCaptions(normalizeCaptionEntries(initialCaptions))
    }
  }, [open, initialCaptions])

  useEffect(() => {
    if (!open) return
    if (Number.isFinite(duration) && (duration as number) > 0) return
    if (!mediaFile) return
    let cancelled = false
    setProbing(true)
    probeMediaDuration(mediaFile).then((d) => {
      if (cancelled) return
      setProbedDuration(d)
      setProbing(false)
    })
    return () => {
      cancelled = true
    }
  }, [open, duration, mediaFile])

  const usedLanguages = useMemo(
    () => new Set(captions.map((c) => c.language.toLowerCase())),
    [captions],
  )

  const filteredLanguages = useMemo(() => {
    const q = search.trim().toLowerCase()
    return SUPPORTED_LANGUAGES.filter((l) => {
      if (!q) return true
      return l.code.toLowerCase().includes(q) || l.label.toLowerCase().includes(q)
    })
  }, [search])

  const startNew = () => {
    setView("language")
    setError(null)
  }

  const pickLanguage = (code: string) => {
    const trimmed = code.trim()
    if (!isValidLanguageCode(trimmed)) {
      setError("Invalid language code")
      return
    }
    if (usedLanguages.has(trimmed.toLowerCase())) {
      setError("A track for this language already exists")
      return
    }
    setError(null)
    setDraft({ language: trimmed, label: findLanguageLabel(trimmed), cues: [] })
    setDraftLanguageOriginal(null)
    setView("editor")
  }

  const editTrack = async (entry: CaptionEntry) => {
    setError(null)
    setLoadingLanguage(entry.language)
    try {
      let cues: CaptionCue[] = []
      const prepRes = await fetch("/api/captions/load-prepare", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_id: fileId, language: entry.language }),
      })
      if (prepRes.ok) {
        const prep = (await prepRes.json()) as { token?: string; path?: string }
        if (prep?.token && prep?.path) {
          const vttRes = await fetch(`/api/load/vtt/${prep.path}`, {
            credentials: "include",
            headers: { "X-Caption-Token": prep.token },
          })
          if (vttRes.ok) {
            cues = parseVTT(await vttRes.text()).cues
          } else if (vttRes.status !== 404) {
            setError("Could not load captions")
            return
          }
        }
      } else if (prepRes.status !== 404) {
        setError("Could not load captions")
        return
      }
      setDraft({ language: entry.language, label: findLanguageLabel(entry.language), cues })
      setDraftLanguageOriginal(entry.language)
      setView("editor")
    } catch {
      setError("Could not load captions")
    } finally {
      setLoadingLanguage(null)
    }
  }

  const prepareToken = async (
    language: string,
    actionType: "upload" | "delete",
  ): Promise<{ token: string; uploadUrl: string } | { error: string }> => {
    try {
      const res = await fetch("/api/captions/prepare", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_id: fileId, language, action: actionType }),
      })
      const json = (await res.json().catch(() => null)) as
        | { token?: string; upload_server_url?: string; error?: string }
        | null
      if (!res.ok || !json?.token) {
        return { error: json?.error || "Could not authorize the request" }
      }
      const url = (json.upload_server_url || uploadServerUrl || "").replace(/\/$/, "")
      if (!url) return { error: "Upload server not configured" }
      return { token: json.token, uploadUrl: url }
    } catch {
      return { error: "Could not reach the server" }
    }
  }

  const saveDraft = async () => {
    if (!draft) return
    const err = validateTrack(draft)
    if (err) {
      setError(err)
      return
    }
    setError(null)
    setSaving(true)
    try {
      const uploadAuth = await fetchUploadAuthContext()
      const prep = await prepareToken(draft.language, "upload")
      if ("error" in prep) {
        setError(prep.error)
        return
      }
      const vtt = serializeVTT(draft)
      const blob = new Blob([vtt], { type: "text/vtt" })
      const fd = new FormData()
      fd.append("file", blob, `${draft.language}.vtt`)
      fd.append("token", prep.token)
      fd.append("language", draft.language)

      const res = await fetch(`${prep.uploadUrl}/api/captions/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${uploadAuth.bearer}` },
        body: fd,
      })
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        setError(json?.error || "Save failed")
        return
      }
      const exists = captions.some((c) => c.language === draft.language)
      const next = exists ? captions : [...captions, { language: draft.language, path: "" }]
      setCaptions(next)
      onCaptionsChange?.(next)
      setView("list")
      setDraft(null)
      setDraftLanguageOriginal(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  const removeTrack = async (language: string) => {
    setError(null)
    setDeleting(language)
    try {
      const uploadAuth = await fetchUploadAuthContext()
      const prep = await prepareToken(language, "delete")
      if ("error" in prep) {
        setError(prep.error)
        return
      }
      const res = await fetch(`${prep.uploadUrl}/api/captions/delete`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${uploadAuth.bearer}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token: prep.token, language }),
      })
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        setError(json?.error || "Delete failed")
        return
      }
      const next = captions.filter((c) => c.language !== language)
      setCaptions(next)
      onCaptionsChange?.(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed")
    } finally {
      setDeleting(null)
    }
  }

  const cancelDraft = () => {
    setView("list")
    setDraft(null)
    setDraftLanguageOriginal(null)
    setError(null)
  }

  const isBusy = saving || loadingLanguage !== null || deleting !== null

  return (
    <Dialog open={open} onOpenChange={(o) => !disabled && !isBusy && onOpenChange(o)}>
      <DialogContent className="w-full rounded-2xl max-w-2xl max-h-[88vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="shrink-0 px-5 pt-5 pb-3 border-b border-border/50">
          <DialogTitle className="flex items-center gap-2 text-base">
            {view !== "list" && (
              <button
                type="button"
                onClick={() => (view === "editor" ? cancelDraft() : setView("list"))}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Back"
                disabled={isBusy}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            {view === "list" && "Captions"}
            {view === "language" && "Choose language"}
            {view === "editor" &&
              (draftLanguageOriginal ? "Edit captions" : "New captions")}
            {view === "editor" && draft && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                <Globe className="w-3 h-3" />
                {draft.label || draft.language}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {view === "list" && (
            <div className="space-y-3">
              {captions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    No captions yet. Add a track in any language.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {captions.map((entry) => {
                    const label = findLanguageLabel(entry.language)
                    const isLoading = loadingLanguage === entry.language
                    const isDeleting = deleting === entry.language
                    return (
                      <div
                        key={entry.language}
                        className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5"
                      >
                        <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{label}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{entry.language}</p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => void editTrack(entry)}
                          disabled={disabled || isBusy}
                          className="h-8 w-8"
                          aria-label="Edit track"
                        >
                          {isLoading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Pencil className="w-3.5 h-3.5" />
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => void removeTrack(entry.language)}
                          disabled={disabled || isBusy}
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          aria-label="Remove track"
                        >
                          {isDeleting ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={startNew}
                disabled={disabled || isBusy}
                className="w-full h-10 border-dashed"
              >
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                Add caption track
              </Button>
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          )}

          {view === "language" && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Type a language code
                </label>
                <div className="flex gap-2">
                  <Input
                    value={customCode}
                    onChange={(e) => setCustomCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        if (customCode.trim()) pickLanguage(customCode)
                      }
                    }}
                    placeholder="e.g. en, fr-CA, zh-Hant"
                    className="bg-muted/40 font-mono text-sm"
                  />
                  <Button
                    type="button"
                    onClick={() => pickLanguage(customCode)}
                    disabled={!customCode.trim()}
                  >
                    Use
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground/70">
                  BCP-47 codes only (letters, digits, dashes).
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Or pick from the list
                </label>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search languages..."
                  className="bg-muted/40 text-sm"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-[40vh] overflow-y-auto pr-1">
                  {filteredLanguages.map((l) => {
                    const used = usedLanguages.has(l.code.toLowerCase())
                    return (
                      <button
                        key={l.code}
                        type="button"
                        disabled={used}
                        onClick={() => pickLanguage(l.code)}
                        className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                          used
                            ? "border-border/40 bg-muted/30 text-muted-foreground/60 cursor-not-allowed"
                            : "border-border/50 hover:border-primary/40 hover:bg-primary/5"
                        }`}
                      >
                        <span className="truncate">{l.label}</span>
                        <span className="text-[10px] font-mono text-muted-foreground ml-2 shrink-0">
                          {l.code}
                        </span>
                      </button>
                    )
                  })}
                  {filteredLanguages.length === 0 && (
                    <p className="col-span-full text-center text-xs text-muted-foreground py-4">
                      No matches.
                    </p>
                  )}
                </div>
              </div>

              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          )}

          {view === "editor" && draft && (
            <div className="space-y-3">
              {effectiveDuration > 0 ? (
                <CaptionEditor
                  cues={draft.cues}
                  duration={effectiveDuration}
                  onChange={(cues) => setDraft({ ...draft, cues })}
                  disabled={disabled || saving}
                />
              ) : (
                <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-6 text-center text-xs text-muted-foreground">
                  {probing ? "Reading media duration..." : "Media duration unavailable."}
                </div>
              )}
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-border/50 px-5 py-3">
          {view === "editor" ? (
            <>
              <Button type="button" variant="ghost" onClick={cancelDraft} disabled={saving}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void saveDraft()} disabled={saving}>
                {saving ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Saving...
                  </span>
                ) : draftLanguageOriginal ? (
                  "Save changes"
                ) : (
                  "Save track"
                )}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isBusy}
            >
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
