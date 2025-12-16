import { useState, useEffect, useRef } from "react";
import { Button } from "~/components/ui/button";
import { Download, X, Loader2 } from "lucide-react";
import { Progress } from "~/components/ui/progress";

interface DownloadButtonProps {
  fileId: string;
}

const DownloadButton = ({ fileId }: DownloadButtonProps) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'>('pending');
  const [error, setError] = useState<string | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const pollJobStatus = async (jobId: string) => {
    try {
      const response = await fetch(`/api/download/status?jobId=${jobId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch job status');
      }

      const data = await response.json();
      setProgress(data.progress || 0);
      setStatus(data.status);

      if (data.status === 'completed') {
        setIsDownloading(false);
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        // Trigger download
        if (data.downloadUrl) {
          const link = document.createElement('a');
          link.href = data.downloadUrl;
          link.download = '';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      } else if (data.status === 'failed' || data.status === 'cancelled') {
        setIsDownloading(false);
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        if (data.error) {
          setError(data.error);
        }
      }
    } catch (error) {
      console.error('Error polling job status:', error);
      setIsDownloading(false);
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }
  };

  const startDownload = async () => {
    try {
      setIsDownloading(true);
      setProgress(0);
      setError(null);
      setStatus('pending');
      abortControllerRef.current = new AbortController();

      const response = await fetch('/api/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fileId }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to start download');
      }

      const data = await response.json();
      setJobId(data.jobId);
      setStatus(data.status);

      // Start polling
      pollIntervalRef.current = setInterval(() => {
        pollJobStatus(data.jobId);
      }, 500); // Poll every 500ms

    } catch (error) {
      console.error('Error starting download:', error);
      setIsDownloading(false);
      setError(error instanceof Error ? error.message : 'Failed to start download');
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }
  };

  const cancelDownload = async () => {
    if (!jobId) return;

    try {
      const response = await fetch('/api/download/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jobId })
      });

      if (response.ok) {
        setStatus('cancelled');
        setIsDownloading(false);
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      }
    } catch (error) {
      console.error('Error cancelling download:', error);
    }
  };

  if (isDownloading) {
    return (
      <div className="space-y-2 w-full">
        <div className="flex items-center gap-2">
          <Progress value={progress} className="flex-1" />
          <span className="text-sm text-muted-foreground min-w-[3rem] text-right">
            {Math.round(progress)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={cancelDownload}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
        {status === 'processing' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Downloading...</span>
          </div>
        )}
        {status === 'cancelled' && (
          <p className="text-sm text-muted-foreground">Download cancelled</p>
        )}
      </div>
    );
  }

  return (
    <Button
      onClick={startDownload}
      variant="outline"
      className="w-full"
      disabled={!!error}
    >
      <Download className="h-4 w-4 mr-2" />
      Download
    </Button>
  );
};

export default DownloadButton;

