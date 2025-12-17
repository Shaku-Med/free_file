import React, { useState } from 'react'
import { useFileContext } from '../../../lib/Context/Context';
import HLSPlayer from '../../../components/components/hlsplayer';
import { LikeButton } from '../../../components/ui/like-button';
import MediaSelectionModal from './MediaSelectionModal';
import { Plus } from 'lucide-react';
import { Button } from '../../../components/ui/button';

const MediaSection = () => {
  const { files, userId } = useFileContext();
  const [playingVideos, setPlayingVideos] = useState<Set<number>>(new Set());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const maxFileSizeBytes = userId ? 400 * 1024 * 1024 : 40 * 1024 * 1024;

  const togglePlayPause = (index: number) => {
    const newPlayingVideos = new Set(playingVideos);
    if (newPlayingVideos.has(index)) {
      newPlayingVideos.delete(index);
    } else {
      newPlayingVideos.add(index);
    }
    setPlayingVideos(newPlayingVideos);
  };

  if (files.length === 0) {
    return (
      <>
        <div className="flex items-center justify-center min-h-screen bg-background">
          <div className="text-center">
            <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-foreground mb-2">No Media Found</h2>
            <p className="text-muted-foreground mb-6">Upload some files to get started</p>
            <Button
              onClick={() => setIsModalOpen(true)}
              className="rounded-full px-8 py-3 font-medium shadow-lg"
            >
              <Plus className="w-5 h-5 mr-2" />
              Add Media
            </Button>
          </div>
        </div>
        <MediaSelectionModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onFilesSelected={() => {}}
          maxFileSizeBytes={maxFileSizeBytes}
        />
      </>
    );
  }

  return (
    <>
      <div className="min-h-screen bg-background">
        <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-xl border-b border-border">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                  <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-foreground">Memories</h1>
                  <p className="text-sm text-muted-foreground">{files.length} files</p>
                </div>
              </div>
            </div>
          </div>
        </div>

      <div className="p-6 space-y-6">
        {files.map((file, index) => {
          const isVideo = file?.file_type?.startsWith('video/');
          const isImage = file?.file_type?.startsWith('image/');
          const isHLS = file?.file_type === 'application/vnd.apple.mpegurl' || file?.endpoint?.includes('.m3u8');
          const isPlaying = playingVideos.has(index);

          return (
            <div key={index} className="group relative bg-card border border-border rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-300">
              <div className="aspect-video relative bg-muted">
                {isHLS ? (
                  <HLSPlayer
                    src={`/api/load/video/${file.endpoint}`}
                    className="w-full h-full"
                    onPlay={() => setPlayingVideos(prev => new Set(prev).add(index))}
                    onPause={() => setPlayingVideos(prev => {
                      const newSet = new Set(prev);
                      newSet.delete(index);
                      return newSet;
                    })}
                    autoPlay={isPlaying}
                    muted={false}
                    loop={false}
                    playsInline
                  />
                ) : isVideo ? (
                  <HLSPlayer
                    src={`/api/load/video/${file.endpoint}`}
                    className="w-full h-full"
                    onPlay={() => setPlayingVideos(prev => new Set(prev).add(index))}
                    onPause={() => setPlayingVideos(prev => {
                      const newSet = new Set(prev);
                      newSet.delete(index);
                      return newSet;
                    })}
                    autoPlay={isPlaying}
                    muted={false}
                    loop={false}
                    playsInline
                  />
                ) : isImage ? (
                  <img
                    src={`/api/load/video/${file.endpoint}`}
                    alt={file.filename}
                    className="w-full h-full object-cover"
                  />
                ) : null}

                <div className="absolute top-3 right-3">
                  <div className="flex items-center space-x-2">
                    {isVideo || isHLS ? (
                      <div className="bg-background/80 backdrop-blur-sm rounded-full px-2 py-1">
                        <div className="flex items-center space-x-1">
                          <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                          <span className="text-xs font-medium text-foreground">LIVE</span>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-background/80 backdrop-blur-sm rounded-full px-2 py-1">
                        <span className="text-xs font-medium text-foreground">PHOTO</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="p-4 bg-card">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-foreground font-medium text-sm mb-1 truncate">{file.filename}</h3>
                    <p className="text-muted-foreground text-xs mb-3">{file.file_type}</p>
                    
                    <div className="flex items-center space-x-4">
                      <LikeButton
                        videoId={file.endpoint}
                        size="sm"
                        showCount={true}
                      />
                      
                      <div className="flex items-center space-x-2">
                        <button className="flex items-center space-x-1 text-muted-foreground hover:text-foreground transition-colors">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
                          </svg>
                          <span className="text-xs font-medium">Share</span>
                        </button>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2 ml-4">
                    <button className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        </div>
      </div>

      {userId && (
        <>
          <div className="fixed bottom-6 right-6 z-40">
            <Button
              onClick={() => setIsModalOpen(true)}
              size="icon"
              className="h-16 w-16 rounded-3xl shadow-lg hover:shadow-xl transition-all duration-300 bg-primary hover:bg-primary/90"
            >
              <Plus className="h-7 w-7" />
            </Button>
          </div>

          <MediaSelectionModal
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            onFilesSelected={() => {}}
            maxFileSizeBytes={maxFileSizeBytes}
          />
        </>
      )}
    </>
  );
};

export default MediaSection;