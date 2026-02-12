import { useState, useCallback, useEffect } from "react";
import type React from "react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Input } from "~/components/ui/input";
import { Send, X, Loader2, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "~/components/ui/dialog";

export interface CommentGif {
  id: string;
  url: string;
  previewUrl: string;
}

interface CommentFormProps {
  fileId: string;
  parentId?: string | null;
  onSubmit: (content: string, gif?: CommentGif | null) => Promise<void>;
  onCancel?: () => void;
  placeholder?: string;
}

const CommentForm = ({
  fileId,
  parentId,
  onSubmit,
  onCancel,
  placeholder = "Add a comment...",
}: CommentFormProps) => {
  const [content, setContent] = useState("");
  const [gif, setGif] = useState<CommentGif | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [gifQuery, setGifQuery] = useState("");
  const [gifResults, setGifResults] = useState<CommentGif[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [gifError, setGifError] = useState<string | null>(null);

  const fetchGifs = useCallback(async (query: string, isTrending: boolean) => {
    setGifLoading(true);
    setGifError(null);
    try {
      const params = new URLSearchParams({ limit: "24" });
      if (isTrending) {
        params.set("trending", "1");
      } else {
        params.set("q", query);
      }
      const res = await fetch(`/api/gif-search?${params.toString()}`);
      const data = await res.json();
      setGifResults(Array.isArray(data.results) ? data.results : []);
      if (data.error) setGifError(data.error);
    } catch {
      setGifResults([]);
      setGifError("Could not load GIFs");
    } finally {
      setGifLoading(false);
    }
  }, []);

  useEffect(() => {
    if (gifOpen) {
      fetchGifs("", true);
    }
  }, [gifOpen, fetchGifs]);

  const searchGifs = useCallback(() => {
    const trimmed = gifQuery.trim();
    if (trimmed) {
      fetchGifs(trimmed, false);
    } else {
      fetchGifs("", true);
    }
  }, [gifQuery, fetchGifs]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const hasText = content.trim().length > 0;
    const hasGif = gif != null;
    if ((!hasText && !hasGif) || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onSubmit(content.trim(), gif || undefined);
      setContent("");
      setGif(null);
    } catch (error) {
      console.error("Error submitting comment:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSubmit = (content.trim().length > 0 || gif != null) && !isSubmitting;

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        {gif && (
          <div className="relative inline-flex w-fit rounded-lg overflow-hidden">
            <img
              src={gif.previewUrl}
              alt="Selected GIF"
              className="h-24 w-auto max-w-full object-contain rounded-lg"
            />
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="absolute right-1 top-1 h-6 w-6 rounded-full shadow-sm bg-black/60 hover:bg-black/80 text-white"
              onClick={() => setGif(null)}
              aria-label="Remove GIF"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={placeholder}
          className="min-h-[40px] max-h-[160px] resize-none rounded-none border-0 border-b-2 border-muted-foreground/30 bg-transparent px-0 py-2 text-sm placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:border-primary transition-colors"
          maxLength={2000}
          disabled={isSubmitting}
        />
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="inline-flex items-center justify-center h-8 px-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              onClick={() => setGifOpen(true)}
              title="Add GIF"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
                <rect x="2" y="4" width="20" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
                <text x="12" y="15.5" textAnchor="middle" fill="currentColor" fontSize="8.5" fontWeight="700" fontFamily="system-ui, sans-serif">GIF</text>
              </svg>
            </button>
            <span className="text-[11px] text-muted-foreground/50 tabular-nums">
              {content.length}/2000
            </span>
          </div>
          <div className="flex items-center gap-2">
            {onCancel && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={onCancel}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
            )}
            <Button
              type="submit"
              size="sm"
              disabled={!canSubmit}
              className="h-8 rounded-full px-4 gap-1.5 text-xs"
            >
              {isSubmitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {isSubmitting ? "Posting..." : "Comment"}
            </Button>
          </div>
        </div>
      </form>

      <Dialog open={gifOpen} onOpenChange={setGifOpen}>
        <DialogContent
          showCloseButton={false}
          className="w-full h-[100dvh] max-w-full max-h-full rounded-none border-0 sm:rounded-lg sm:border sm:max-w-2xl sm:h-auto sm:max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2 sm:px-5 sm:pt-5">
            <DialogTitle className="text-lg font-semibold">Choose a GIF</DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full shrink-0"
              onClick={() => setGifOpen(false)}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Search */}
          <div className="px-4 pb-2 sm:px-5 space-y-1.5">
            <div className="flex gap-2 items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search GIFs..."
                  value={gifQuery}
                  onChange={(e) => setGifQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      searchGifs();
                    }
                  }}
                  className="pl-9 h-10 sm:h-9 rounded-full bg-muted/50 border-0 focus-visible:ring-1 focus-visible:ring-primary"
                />
              </div>
              <Button
                type="button"
                onClick={searchGifs}
                disabled={gifLoading}
                size="icon"
                className="h-10 w-10 sm:h-9 sm:w-9 rounded-full shrink-0"
              >
                {gifLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </Button>
            </div>
            {!gifQuery.trim() && (
              <p className="text-xs text-muted-foreground">
                Showing trending GIFs
              </p>
            )}
          </div>

          {gifError && (
            <div className="mx-4 sm:mx-5 rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2">
              {gifError}
            </div>
          )}

          {/* GIF grid — scrollable area fills remaining space */}
          <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 pb-2">
            {gifLoading && gifResults.length === 0 ? (
              <div className="flex items-center justify-center h-48">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : gifResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-sm gap-2">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="opacity-40">
                  <rect x="2" y="4" width="20" height="16" rx="3" stroke="currentColor" strokeWidth="1.5" />
                  <text x="12" y="15.5" textAnchor="middle" fill="currentColor" fontSize="8.5" fontWeight="700" fontFamily="system-ui, sans-serif">GIF</text>
                </svg>
                <span className="text-center px-4">
                  {gifQuery.trim()
                    ? "No GIFs found. Try another search."
                    : "No trending GIFs right now."}
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {gifResults.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="rounded-lg overflow-hidden border border-border bg-background hover:ring-2 hover:ring-primary hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary transition-all active:scale-95"
                    onClick={() => {
                      setGif(item);
                      setGifOpen(false);
                    }}
                  >
                    <img
                      src={item.previewUrl}
                      alt=""
                      loading="lazy"
                      className="w-full aspect-square object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Powered by GIPHY attribution */}
          <div className="flex items-center justify-center px-4 py-3 border-t border-border bg-background/80 backdrop-blur-sm shrink-0">
            <a
              href="https://giphy.com"
              target="_blank"
              rel="noopener noreferrer"
              className="opacity-80 hover:opacity-100 transition-opacity"
              aria-label="Powered by GIPHY"
            >
              <img
                src="/giphy-attribution-marks/Giphy%20Attribution%20Marks/Static%20Logos/Small/Light%20Backgrounds/PoweredBy_200px-White_HorizLogo.png"
                alt="Powered by GIPHY"
                className="h-6 w-auto object-contain"
              />
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default CommentForm;
