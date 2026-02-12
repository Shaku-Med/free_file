import { useState, useCallback, useEffect } from "react";
import type React from "react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Input } from "~/components/ui/input";
import { Send, ImageIcon, X, Loader2, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
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
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {gif && (
          <div className="relative inline-flex w-fit rounded-xl overflow-hidden border border-border bg-muted/30">
            <img
              src={gif.previewUrl}
              alt="Selected GIF"
              className="h-28 w-auto max-w-full object-contain"
            />
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="absolute right-1.5 top-1.5 h-7 w-7 rounded-full shadow-sm"
              onClick={() => setGif(null)}
              aria-label="Remove GIF"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={placeholder}
          className="min-h-[88px] resize-y rounded-xl border-0 bg-muted/50 focus-visible:ring-2"
          maxLength={2000}
          disabled={isSubmitting}
        />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {content.length}/2000
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setGifOpen(true)}
              title="Add GIF"
            >
              <ImageIcon className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex gap-2">
            {onCancel && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
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
              className="gap-2"
            >
              <Send className="h-4 w-4" />
              {isSubmitting ? "Posting..." : "Post"}
            </Button>
          </div>
        </div>
      </form>

      <Dialog open={gifOpen} onOpenChange={setGifOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-4 p-4">
          <DialogHeader className="space-y-2">
            <DialogTitle className="text-lg">Choose a GIF</DialogTitle>
            <div className="flex gap-2">
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
                className="flex-1"
              />
              <Button
                type="button"
                onClick={searchGifs}
                disabled={gifLoading}
                className="shrink-0 gap-1.5"
              >
                {gifLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Search
              </Button>
            </div>
            {!gifQuery.trim() && (
              <p className="text-xs text-muted-foreground">
                Showing trending. Type a word and search to find a specific GIF.
              </p>
            )}
          </DialogHeader>

          {gifError && (
            <div className="rounded-lg bg-destructive/10 text-destructive text-sm px-3 py-2">
              {gifError}
            </div>
          )}

          <div className="flex-1 min-h-[240px] overflow-y-auto rounded-lg border border-border bg-muted/20">
            {gifLoading && gifResults.length === 0 ? (
              <div className="flex items-center justify-center h-48">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : gifResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-sm gap-1">
                <ImageIcon className="h-10 w-10 opacity-50" />
                <span>
                  {gifQuery.trim()
                    ? "No GIFs found. Try another search."
                    : "No trending GIFs right now."}
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-4 gap-2 p-2">
                {gifResults.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="rounded-lg overflow-hidden border border-border bg-background hover:ring-2 hover:ring-primary hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary transition-all"
                    onClick={() => {
                      setGif(item);
                      setGifOpen(false);
                    }}
                  >
                    <img
                      src={item.previewUrl}
                      alt=""
                      className="w-full aspect-square object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default CommentForm;
