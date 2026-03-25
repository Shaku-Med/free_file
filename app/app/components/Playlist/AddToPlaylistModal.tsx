import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent } from '~/components/ui/dialog';
import { Plus, Check, Loader2, ListVideo } from 'lucide-react';
import CreatePlaylistModal from './CreatePlaylistModal';

interface Playlist {
  id: string;
  title: string;
  unique_id: string;
  item_count: number;
}

interface AddToPlaylistModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileId: string;
}

export default function AddToPlaylistModal({ open, onOpenChange, fileId }: AddToPlaylistModalProps) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [addedTo, setAddedTo] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [fetchError, setFetchError] = useState('');

  const fetchPlaylists = useCallback(async () => {
    setLoading(true);
    setFetchError('');
    try {
      const [playlistsRes, containsRes] = await Promise.all([
        fetch('/api/playlists'),
        fetch(`/api/playlists/contains?file_id=${fileId}`),
      ]);
      const playlistsJson = await playlistsRes.json();
      if (playlistsRes.ok) {
        setPlaylists(playlistsJson.playlists || []);
      } else {
        setFetchError(playlistsJson.error || 'Could not load playlists');
        return;
      }
      if (containsRes.ok) {
        const containsJson = await containsRes.json();
        setAddedTo(new Set(containsJson.playlist_ids || []));
      }
    } catch {
      setFetchError('Network error');
    } finally {
      setLoading(false);
    }
  }, [fileId]);

  useEffect(() => {
    if (open) {
      fetchPlaylists();
    }
  }, [open, fetchPlaylists]);

  const handleAdd = useCallback(async (playlistId: string) => {
    setAdding(playlistId);
    try {
      const res = await fetch(`/api/playlists/${playlistId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: fileId }),
      });
      if (res.ok || res.status === 409) {
        setAddedTo(prev => new Set(prev).add(playlistId));
      }
    } catch {
    } finally {
      setAdding(null);
    }
  }, [fileId]);

  const handleRemove = useCallback(async (playlistId: string) => {
    setAdding(playlistId);
    try {
      const res = await fetch(`/api/playlists/${playlistId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', file_id: fileId }),
      });
      if (res.ok) {
        setAddedTo(prev => {
          const next = new Set(prev);
          next.delete(playlistId);
          return next;
        });
      }
    } catch {
    } finally {
      setAdding(null);
    }
  }, [fileId]);

  const handleCreated = useCallback((playlist: { id: string; title: string; unique_id: string }) => {
    setPlaylists(prev => [{ ...playlist, item_count: 0 }, ...prev]);
  }, []);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[360px] p-0 gap-0 overflow-hidden" showCloseButton={false}>
          <div className="px-5 pt-5 pb-3">
            <p className="text-base font-semibold">Save to...</p>
          </div>

          <div className="max-h-[280px] overflow-y-auto px-2">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : fetchError ? (
              <div className="text-center py-8 px-4">
                <p className="text-sm text-muted-foreground">{fetchError}</p>
                <button onClick={fetchPlaylists} className="text-sm text-primary mt-2 hover:underline">Retry</button>
              </div>
            ) : playlists.length === 0 ? (
              <div className="text-center py-8 px-4">
                <ListVideo className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No playlists yet</p>
              </div>
            ) : (
              playlists.map((pl) => {
                const isAdded = addedTo.has(pl.id);
                const isLoading = adding === pl.id;
                return (
                  <button
                    key={pl.id}
                    onClick={() => isAdded ? handleRemove(pl.id) : handleAdd(pl.id)}
                    disabled={isLoading}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/60 transition-colors disabled:opacity-50"
                  >
                    <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${isAdded ? 'bg-primary/15' : 'bg-muted'}`}>
                      {isLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : isAdded ? (
                        <Check className="w-3.5 h-3.5 text-primary" />
                      ) : (
                        <ListVideo className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="text-left min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{pl.title}</p>
                      <p className="text-[11px] text-muted-foreground">{pl.item_count} {pl.item_count === 1 ? 'video' : 'videos'}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div className="border-t px-2 py-2">
            <button
              onClick={() => setCreateOpen(true)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/60 transition-colors"
            >
              <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                <Plus className="w-4 h-4 text-muted-foreground" />
              </div>
              <span className="text-sm font-medium">New playlist</span>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <CreatePlaylistModal open={createOpen} onOpenChange={setCreateOpen} onCreated={handleCreated} />
    </>
  );
}
