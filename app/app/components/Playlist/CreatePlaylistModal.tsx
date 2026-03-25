import { useState, useCallback } from 'react';
import { Dialog, DialogContent } from '~/components/ui/dialog';

interface CreatePlaylistModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (playlist: { id: string; title: string; unique_id: string }) => void;
}

export default function CreatePlaylistModal({ open, onOpenChange, onCreated }: CreatePlaylistModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = useCallback(async () => {
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), description: description.trim() || undefined, is_public: isPublic }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to create playlist');
        return;
      }
      onCreated?.(json.playlist);
      setTitle('');
      setDescription('');
      setIsPublic(true);
      onOpenChange(false);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [title, description, isPublic, onCreated, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[420px]" showCloseButton={false}>
        <div className="space-y-4">
          <p className="text-base font-semibold">New playlist</p>

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Playlist title"
            autoFocus
            className="w-full px-0 py-2 text-sm bg-transparent border-b border-border focus:border-foreground focus:outline-none transition-colors placeholder:text-muted-foreground/60"
            maxLength={100}
            onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) handleCreate(); }}
          />

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="w-full px-0 py-2 text-sm bg-transparent border-b border-border focus:border-foreground focus:outline-none transition-colors resize-none placeholder:text-muted-foreground/60"
            rows={2}
            maxLength={500}
          />

          <label className="flex items-center gap-2.5 cursor-pointer select-none py-1">
            <div className={`relative w-9 h-5 rounded-full transition-colors ${isPublic ? 'bg-primary' : 'bg-muted'}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${isPublic ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-sm">{isPublic ? 'Public' : 'Private'}</span>
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <button
              onClick={() => onOpenChange(false)}
              className="px-4 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={loading || !title.trim()}
              className="px-5 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-full hover:bg-primary/90 transition-colors disabled:opacity-40"
            >
              {loading ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
