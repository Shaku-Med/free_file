import { useState, useCallback } from "react";
import { Plus, Upload, CheckCircle, XCircle, RotateCcw, SkipForward, Loader2, Video } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Progress } from "~/components/ui/progress";
import MediaSelectionModal from "./MediaSelectionModal";
import { convertToHLS } from "~/lib/HlsHandler";
import { GenerateUniqueID } from "~/lib/GenerateUniqueID";

interface UploadItem {
  id: string;
  file: File;
  status: 'pending' | 'uploading' | 'success' | 'error' | 'skipped';
  progress: number;
  error?: string;
  retryCount: number;
}

export default function FloatingActionButton() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [currentUploadIndex, setCurrentUploadIndex] = useState(0);

  let VideoFetchPush = async (index: number, segment: { blob: Blob, name: string }, length: number, segmentUrls: { blob: Blob, name: string }[], uniqueID: string) => {
    try {
      if (index >= length) {
        return true;
      }

      let formData = new FormData();
      formData.append('file', segment.blob);
      formData.append('name', segment.name);
      formData.append('uniqueID', uniqueID);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        return false;
      }

      return VideoFetchPush(index + 1, segmentUrls[index + 1], length, segmentUrls, uniqueID);
    }
    catch {
      return false;
    }
  }

  const uploadVideo = async (file: File): Promise<boolean> => {
    try {
      const { m3u8Url, segmentUrls } = await convertToHLS(file);
      if (!m3u8Url || segmentUrls.length === 0) {
        return false;
      }

      let index = 0;
      let uniqueID = GenerateUniqueID();
      let Done = VideoFetchPush(index, segmentUrls[index], segmentUrls.length, segmentUrls, uniqueID);
      if (!Done) {
        return false;
      }

      return true;
    } catch (error) {
      console.error(`❌ HLS conversion failed:`, error);
      
      return false;
    }
  };

  const uploadFile = async (file: File): Promise<boolean> => {
    try {
      if(file.type.startsWith(`video/`) || file.type.startsWith(`audio/`)) {
        return uploadVideo(file);
      }
      
      if(file.type.startsWith(`image/`)) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('name', file.name);
        formData.append('uniqueID', GenerateUniqueID());

        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });
        
        if (!response.ok) {
          throw new Error(`Upload failed: ${response.statusText}`);
        }

        const result = await response.json();
        return result.success;
      }
      
      return true;
    } catch (error) {
      console.error('Upload error:', error);
      return false;
    }
  };

  const processUploadQueue = useCallback(async () => {
    if (isUploading || uploadQueue.length === 0) return;
    
    setIsUploading(true);
    const pendingItems = uploadQueue.filter(item => item.status === 'pending');
    
    for (let i = 0; i < pendingItems.length; i++) {
      const item = pendingItems[i];
      const itemIndex = uploadQueue.findIndex(uploadItem => uploadItem.id === item.id);
      
      setCurrentUploadIndex(itemIndex);
      
      setUploadQueue(prev => prev.map(uploadItem => 
        uploadItem.id === item.id 
          ? { ...uploadItem, status: 'uploading', progress: 0 }
          : uploadItem
      ));

      const success = await uploadFile(item.file);
      
      setUploadQueue(prev => prev.map(uploadItem => 
        uploadItem.id === item.id 
          ? { 
              ...uploadItem, 
              status: success ? 'success' : 'error',
              progress: success ? 100 : uploadItem.progress,
              error: success ? undefined : (item.file.type.startsWith('video/') || item.file.type.startsWith('audio/')) 
                ? 'HLS conversion failed - check console for details' 
                : item.file.type.startsWith('image/')
                ? 'Image upload failed - check console for details'
                : 'Upload failed'
            }
          : uploadItem
      ));

      if (!success) {
        break;
      }
    }
    
    setIsUploading(false);
    setCurrentUploadIndex(-1);
  }, [isUploading, uploadQueue]);

  const retryUpload = useCallback((itemId: string) => {
    setUploadQueue(prev => prev.map(item => 
      item.id === itemId 
        ? { ...item, status: 'pending', error: undefined, retryCount: item.retryCount + 1 }
        : item
    ));
  }, []);

  const skipUpload = useCallback((itemId: string) => {
    setUploadQueue(prev => prev.map(item => 
      item.id === itemId 
        ? { ...item, status: 'skipped' }
        : item
    ));
  }, []);

  const removeFromQueue = useCallback((itemId: string) => {
    setUploadQueue(prev => prev.filter(item => item.id !== itemId));
  }, []);

  const handleMediaSelected = (files: File[]) => {
    const newUploadItems: UploadItem[] = files.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      status: 'pending' as const,
      progress: 0,
      retryCount: 0
    }));
    
    setUploadQueue(prev => [...prev, ...newUploadItems]);
    setIsModalOpen(false);
  };

  const startUpload = useCallback(() => {
    processUploadQueue();
  }, [processUploadQueue]);

  const clearCompleted = useCallback(() => {
    setUploadQueue(prev => prev.filter(item => 
      item.status !== 'success' && item.status !== 'skipped'
    ));
  }, []);

  const getStatusIcon = (status: UploadItem['status']) => {
    switch (status) {
      case 'pending':
        return <Upload className="w-4 h-4 text-muted-foreground" />;
      case 'uploading':
        return <Loader2 className="w-4 h-4 text-primary animate-spin" />;
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-destructive" />;
      case 'skipped':
        return <SkipForward className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusColor = (status: UploadItem['status']) => {
    switch (status) {
      case 'pending':
        return 'text-muted-foreground';
      case 'uploading':
        return 'text-primary';
      case 'success':
        return 'text-green-500';
      case 'error':
        return 'text-destructive';
      case 'skipped':
        return 'text-muted-foreground';
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const pendingCount = uploadQueue.filter(item => item.status === 'pending').length;
  const successCount = uploadQueue.filter(item => item.status === 'success').length;
  const errorCount = uploadQueue.filter(item => item.status === 'error').length;

  return (
    <>
      <div className="fixed bottom-6 right-6 sm:bottom-8 sm:right-8 z-40 space-y-3">
        {uploadQueue.length > 0 && (
          <div className="bg-background/95 backdrop-blur-xl rounded-2xl border border-border/20 ios-shadow-lg p-4 max-w-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">Upload Queue</h3>
              <div className="flex gap-2">
                {pendingCount > 0 && (
                  <Button
                    onClick={startUpload}
                    disabled={isUploading}
                    size="sm"
                    className="rounded-xl ios-scale"
                  >
                    {isUploading ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Upload className="w-4 h-4 mr-2" />
                    )}
                    Start
                  </Button>
                )}
                {(successCount > 0 || errorCount > 0) && (
                  <Button
                    onClick={clearCompleted}
                    variant="outline"
                    size="sm"
                    className="rounded-xl ios-scale"
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {uploadQueue.map((item, index) => (
                <div
                  key={item.id}
                  className={`flex items-center justify-between p-3 rounded-xl transition-colors ${
                    index === currentUploadIndex 
                      ? 'bg-primary/10 border border-primary/20' 
                      : 'bg-muted/30'
                  }`}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {getStatusIcon(item.status)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(item.file.size)}
                        {item.retryCount > 0 && ` • Retry ${item.retryCount}`}
                      </p>
                      {item.status === 'uploading' && (
                        <Progress value={item.progress} className="mt-1 h-1" />
                      )}
                      {item.error && (
                        <p className="text-xs text-destructive mt-1">{item.error}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {item.status === 'error' && (
                      <>
                        <Button
                          onClick={() => retryUpload(item.id)}
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-xl hover:bg-primary/10 ios-scale"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </Button>
                        <Button
                          onClick={() => skipUpload(item.id)}
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-xl hover:bg-muted ios-scale"
                        >
                          <SkipForward className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                    {(item.status === 'success' || item.status === 'skipped') && (
                      <Button
                        onClick={() => removeFromQueue(item.id)}
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-xl hover:bg-destructive/10 hover:text-destructive ios-scale"
                      >
                        <XCircle className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {uploadQueue.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border/20">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Pending: {pendingCount}</span>
                  <span>Success: {successCount}</span>
                  <span>Errors: {errorCount}</span>
                </div>
              </div>
            )}
          </div>
        )}

        <Button
          onClick={() => setIsModalOpen(true)}
          size="icon"
          className="h-16 w-16 rounded-3xl ios-shadow-lg hover:ios-shadow-xl transition-all duration-300 ios-scale bg-primary hover:bg-primary/90"
        >
          <Plus className="h-7 w-7" />
        </Button>
      </div>

      <MediaSelectionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onFilesSelected={handleMediaSelected}
      />
    </>
  );
}
