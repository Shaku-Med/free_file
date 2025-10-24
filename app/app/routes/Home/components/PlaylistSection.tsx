import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Calendar, FileVideo, ExternalLink, RefreshCw, Play } from 'lucide-react';
import { usePlaylists } from '../hooks/usePlaylists';

interface PlaylistSectionProps {
  className?: string;
}

export default function PlaylistSection({ className = '' }: PlaylistSectionProps) {
  const { playlists, loading, error, refetch } = usePlaylists();

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getGitHubUrl = (endpoint: string) => {
    return `https://github.com/${process.env.GITHUB_OWNER || 'your-username'}/Memories/blob/main/${endpoint}`;
  };

  const getRawGitHubUrl = (endpoint: string) => {
    return `https://raw.githubusercontent.com/${process.env.GITHUB_OWNER || 'your-username'}/Memories/main/${endpoint}`;
  };


  if (loading) {
    return (
      <div className={`space-y-4 ${className}`}>
        <h2 className="text-2xl font-bold text-foreground">Your Playlists</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-4 bg-muted rounded w-3/4"></div>
                <div className="h-3 bg-muted rounded w-1/2"></div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="h-3 bg-muted rounded"></div>
                  <div className="h-3 bg-muted rounded w-2/3"></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`space-y-4 ${className}`}>
        <h2 className="text-2xl font-bold text-foreground">Your Playlists</h2>
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-destructive mb-4">{error}</p>
            <Button onClick={refetch} variant="outline">
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (playlists.length === 0) {
    return (
      <div className={`space-y-4 ${className}`}>
        <h2 className="text-2xl font-bold text-foreground">Your Playlists</h2>
        <Card>
          <CardContent className="p-6 text-center">
            <FileVideo className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground mb-4">No playlists found</p>
            <p className="text-sm text-muted-foreground">
              Upload some .m3u8 files to see them here
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground">Your Playlists</h2>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{playlists.length} playlist{playlists.length !== 1 ? 's' : ''}</Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={refetch}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {playlists.map((playlist) => (
          <Card key={playlist.uniqueID} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-semibold truncate">
                {playlist.filename}
              </CardTitle>
            </CardHeader>
            
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span>{formatDate(playlist.created_at)}</span>
              </div>
              
              <div className="space-y-2">
                <div className="text-sm">
                  <span className="font-medium">ID:</span>
                  <code className="ml-2 px-2 py-1 bg-muted rounded text-xs">
                    {playlist.uniqueID}
                  </code>
                </div>
                
                <div className="text-sm">
                  <span className="font-medium">Path:</span>
                  <p className="text-muted-foreground text-xs mt-1 break-all">
                    {playlist.endpoint}
                  </p>
                </div>
              </div>
              
              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(getRawGitHubUrl(playlist.endpoint), '_blank')}
                  className="flex-1"
                >
                  <Play className="h-4 w-4 mr-2" />
                  Load Playlist
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(getGitHubUrl(playlist.endpoint), '_blank')}
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
