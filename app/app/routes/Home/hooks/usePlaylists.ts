import { useState, useEffect, useCallback } from 'react';

interface PlaylistRecord {
  _id?: string;
  created_at: string;
  endpoint: string;
  filename: string;
  uniqueID: string;
}

interface UsePlaylistsReturn {
  playlists: PlaylistRecord[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function usePlaylists(): UsePlaylistsReturn {
  const [playlists, setPlaylists] = useState<PlaylistRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPlaylists = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch('/api/get/?next=2');
      const data = await response.json();
      
      if (data.success) {
        setPlaylists(data.data);
      } else {
        setError(data.error || 'Failed to fetch playlists');
      }
    } catch (err) {
      setError('Network error');
      console.error('Error fetching playlists:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlaylists();
  }, [fetchPlaylists]);

  return {
    playlists,
    loading,
    error,
    refetch: fetchPlaylists
  };
}
