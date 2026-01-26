package worker

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/go-github/v62/github"
	"goupload/lib/assembler"
	"goupload/lib/ffmpeg"
	ghlib "goupload/lib/github"
	"goupload/lib/logger"
	"goupload/lib/nsfw"
	"goupload/lib/queue"
	"goupload/lib/webhook"
)

type Config struct {
	ChunksDir    string
	OutputDir    string
	TempDir      string
	HLSDir       string
	ThumbnailDir string
	NSFWApiURL   string
	NSFWApiSecret string // X-Webhook-Secret for app /api/nsfw/detect; often UPLOAD_WEBHOOK_SECRET
	// GitHub: if GitHubClient is nil, uploads to GitHub are skipped.
	GitHubClient *github.Client
	GitHubOwner  string
	GitHubRepo   string
}

type Worker struct {
	queue    *queue.Client
	log      *logger.Logger
	nsfw     *nsfw.Detector
	cfg      Config
	stopCh   chan struct{}
	wg       sync.WaitGroup
}

func New(q *queue.Client, log *logger.Logger, cfg Config) *Worker {
	if cfg.TempDir == "" {
		cfg.TempDir = "upload/temp_processing"
	}
	if cfg.HLSDir == "" {
		cfg.HLSDir = "upload/hls"
	}
	if cfg.ThumbnailDir == "" {
		cfg.ThumbnailDir = "upload/thumbnails"
	}

	return &Worker{
		queue:  q,
		log:    log,
		nsfw:   nsfw.NewDetector(cfg.NSFWApiURL, cfg.NSFWApiSecret),
		cfg:    cfg,
		stopCh: make(chan struct{}),
	}
}

func (w *Worker) Start() {
	w.wg.Add(1)
	go w.run()
}

func (w *Worker) Stop() {
	close(w.stopCh)
	w.wg.Wait()
}

func (w *Worker) run() {
	defer w.wg.Done()
	w.log.Infof("worker started")

	for {
		select {
		case <-w.stopCh:
			w.log.Infof("worker stopping")
			return
		default:
		}

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		job, err := w.queue.Dequeue(ctx, 3*time.Second)
		cancel()

		if err != nil {
			w.log.Errorf("dequeue error: %s", err.Error())
			time.Sleep(time.Second)
			continue
		}

		if job == nil {
			continue
		}

		w.processJob(job)
	}
}

func (w *Worker) processJob(job *queue.Job) {
	start := time.Now()
	_ = w.queue.SetJobStatus(context.Background(), job.ID, "running")
	webhook.NotifyJobStatus(webhook.Payload{JobID: job.ID, Status: "running", UploadID: job.UploadID, UserID: job.UserID, FileName: job.FileName, FileSize: job.FileSize})
	w.log.Infof("processing job=%s user=%s upload=%s file=%s", job.ID, job.UserID, job.UploadID, job.FileName)

	result, err := assembler.Assemble(assembler.Config{
		ChunksDir:   w.cfg.ChunksDir,
		OutputDir:   w.cfg.OutputDir,
		UserID:      job.UserID,
		UploadID:    job.UploadID,
		FileName:    job.FileName,
		TotalChunks: job.TotalChunks,
	})
	if err != nil {
		w.log.Errorf("assembly failed job=%s err=%s", job.ID, err.Error())
		_ = w.queue.SetJobStatus(context.Background(), job.ID, "failed")
		webhook.NotifyJobStatus(webhook.Payload{JobID: job.ID, Status: "failed", UploadID: job.UploadID, UserID: job.UserID, FileName: job.FileName, FileSize: job.FileSize})
		return
	}
	w.log.Infof("assembled job=%s output=%s size=%d", job.ID, result.OutputPath, result.FileSize)

	if err := assembler.Cleanup(w.cfg.ChunksDir, job.UserID, job.UploadID); err != nil {
		w.log.Errorf("chunk cleanup failed job=%s err=%s", job.ID, err.Error())
	} else {
		_ = os.Remove(filepath.Join(w.cfg.ChunksDir, job.UserID)) // remove empty user chunk dir
	}

	if !isVideo(job.FileName) {
		w.log.Infof("not a video, skipping processing job=%s", job.ID)
		dateFolder := ghlib.DateFolder(time.Now())
		ghPath := dateFolder + "/" + job.UploadID + "/" + job.FileName
		if err := ghlib.UploadLocalFile(context.Background(), w.cfg.GitHubClient, w.cfg.GitHubOwner, w.cfg.GitHubRepo, ghPath, result.OutputPath, "Upload "+job.FileName); err != nil {
			w.log.Errorf("github upload failed job=%s path=%s err=%s", job.ID, ghPath, err.Error())
			_ = w.queue.SetJobStatus(context.Background(), job.ID, "failed")
			webhook.NotifyJobStatus(webhook.Payload{JobID: job.ID, Status: "failed", UploadID: job.UploadID, UserID: job.UserID, FileName: job.FileName, FileSize: job.FileSize})
			return
		}
		w.log.Infof("github uploaded job=%s path=%s", job.ID, ghPath)

		// NSFW check for images (same as app: detect on file; on error treat as not adult)
		isAdult := false
		if isImage(job.FileName) && result.FileSize > 0 && result.FileSize <= 25*1024*1024 {
			data, rerr := os.ReadFile(result.OutputPath)
			if rerr != nil {
				w.log.Errorf("nsfw read failed job=%s err=%s", job.ID, rerr.Error())
			} else {
				res, derr := w.nsfw.Detect(data)
				if derr != nil {
					w.log.Errorf("nsfw detection failed job=%s err=%s", job.ID, derr.Error())
				} else {
					isAdult = res.IsNSFW
					w.log.Infof("nsfw check job=%s adult=%v", job.ID, isAdult)
				}
			}
		}

		// Cleanup: remove assembled file and uploadID dir (wipe fully)
		if err := os.Remove(result.OutputPath); err != nil {
			w.log.Errorf("cleanup assembled file failed job=%s err=%s", job.ID, err.Error())
		} else {
			w.log.Infof("cleanup assembled file job=%s path=%s", job.ID, result.OutputPath)
		}
		assembledDir := filepath.Dir(result.OutputPath)
		_ = os.RemoveAll(assembledDir)
		_ = os.Remove(filepath.Dir(assembledDir)) // empty user dir

		_ = w.queue.SetJobStatus(context.Background(), job.ID, "completed")
		webhook.NotifyJobStatus(webhook.Payload{JobID: job.ID, Status: "completed", UploadID: job.UploadID, UserID: job.UserID, FileName: job.FileName, FileSize: job.FileSize, Endpoint: ghPath, IsAdult: &isAdult})
		w.log.Infof("job complete job=%s duration=%s", job.ID, time.Since(start))
		return
	}

	thumbDir := filepath.Join(w.cfg.ThumbnailDir, job.UserID, job.UploadID)
	thumbResult, err := ffmpeg.ExtractThumbnails(result.OutputPath, thumbDir)
	if err != nil {
		w.log.Errorf("thumbnail extraction failed job=%s err=%s", job.ID, err.Error())
	} else {
		w.log.Infof("extracted %d thumbnails job=%s duration=%.2fs", len(thumbResult.Thumbnails), job.ID, thumbResult.Duration)

		previewPath, metaPath, perr := ffmpeg.BuildThumbnailPreview(thumbDir, thumbResult)
		if perr != nil {
			w.log.Errorf("thumbnail preview failed job=%s err=%s", job.ID, perr.Error())
		} else {
			w.log.Infof("thumbnail_preview job=%s preview=%s meta=%s", job.ID, previewPath, metaPath)
		}
	}

	isAdult := false
	if thumbResult != nil && len(thumbResult.Thumbnails) > 0 {
		step := 1
		if len(thumbResult.Thumbnails) > 20 {
			step = len(thumbResult.Thumbnails) / 20
		}
		var subset [][]byte
		for i := 0; i < len(thumbResult.Thumbnails) && len(subset) < 20; i += step {
			subset = append(subset, thumbResult.Thumbnails[i].Data)
		}
		isAdult, err = w.nsfw.DetectBatch(subset)
		if err != nil {
			w.log.Errorf("nsfw detection failed job=%s err=%s", job.ID, err.Error())
		} else {
			w.log.Infof("nsfw check job=%s adult=%v", job.ID, isAdult)
		}
	}

	hlsDir := filepath.Join(w.cfg.HLSDir, job.UserID, job.UploadID)
	hlsAll, err := ffmpeg.ConvertToHLSAllQualities(result.OutputPath, hlsDir, ffmpeg.HLSOptions{
		SegmentTime: 10,
	})
	if err != nil {
		w.log.Errorf("hls conversion failed job=%s err=%s", job.ID, err.Error())
	} else {
		w.log.Infof("hls all qualities job=%s master=%s low=%d medium=%d high=%d", job.ID, hlsAll.MasterPath, len(hlsAll.Low.SegmentFiles), len(hlsAll.Medium.SegmentFiles), len(hlsAll.High.SegmentFiles))
	}

	// Upload to {dateFolder}/{uploadID}/ - same structure as app
	dateFolder := ghlib.DateFolder(time.Now())
	ghPrefix := dateFolder + "/" + job.UploadID + "/"
	videoEndpoint := ""
	var thumbnailPaths []string
	var videoDuration float64

	if hlsAll != nil {
		// Upload HLS to {dateFolder}/{uploadID}/ (no hls/ prefix)
		if err := ghlib.UploadDir(context.Background(), w.cfg.GitHubClient, w.cfg.GitHubOwner, w.cfg.GitHubRepo, ghPrefix, hlsDir, w.log.Infof); err != nil {
			w.log.Errorf("github hls upload failed job=%s err=%s", job.ID, err.Error())
			_ = w.queue.SetJobStatus(context.Background(), job.ID, "failed")
			webhook.NotifyJobStatus(webhook.Payload{JobID: job.ID, Status: "failed", UploadID: job.UploadID, UserID: job.UserID, FileName: job.FileName, FileSize: job.FileSize})
			return
		}
		w.log.Infof("github hls uploaded job=%s path=%s", job.ID, ghPrefix)
		// Endpoint is path to master.m3u8: {dateFolder}/{uploadID}/master.m3u8
		videoEndpoint = dateFolder + "/" + job.UploadID + "/master.m3u8"
		
		// Cleanup: remove HLS dir and empty user parent
		if err := os.RemoveAll(hlsDir); err != nil {
			w.log.Errorf("cleanup hls failed job=%s err=%s", job.ID, err.Error())
		} else {
			w.log.Infof("cleanup hls job=%s path=%s", job.ID, hlsDir)
			_ = os.Remove(filepath.Dir(hlsDir))
		}
	}

	if thumbResult != nil {
		videoDuration = thumbResult.Duration
		if err := ghlib.UploadDirFlat(context.Background(), w.cfg.GitHubClient, w.cfg.GitHubOwner, w.cfg.GitHubRepo, ghPrefix, thumbDir, w.log.Infof); err != nil {
			w.log.Errorf("github thumbnails upload failed job=%s err=%s", job.ID, err.Error())
		} else {
			w.log.Infof("github thumbnails uploaded job=%s path=%s", job.ID, ghPrefix)
			// Collect thumbnail paths for database
			for i := range thumbResult.Thumbnails {
				// Individual thumbnails: {prefix}thumb_0001.jpg, thumb_0002.jpg, etc.
				thumbnailPaths = append(thumbnailPaths, ghPrefix+filepath.Base(thumbResult.Thumbnails[i].Path))
			}
			// Add preview files
			thumbnailPaths = append(thumbnailPaths, ghPrefix+"thumbnail_preview.jpg")
			thumbnailPaths = append(thumbnailPaths, ghPrefix+"thumbnail_preview.json")
			
			// Cleanup: remove thumbnails dir and empty user parent
			if err := os.RemoveAll(thumbDir); err != nil {
				w.log.Errorf("cleanup thumbnails failed job=%s err=%s", job.ID, err.Error())
			} else {
				w.log.Infof("cleanup thumbnails job=%s path=%s", job.ID, thumbDir)
				_ = os.Remove(filepath.Dir(thumbDir))
			}
		}
	}

	// Cleanup: remove assembled file, uploadID dir, and empty user dir
	if err := os.Remove(result.OutputPath); err != nil {
		w.log.Errorf("cleanup assembled file failed job=%s err=%s", job.ID, err.Error())
	} else {
		w.log.Infof("cleanup assembled file job=%s path=%s", job.ID, result.OutputPath)
	}
	assembledDir := filepath.Dir(result.OutputPath)
	_ = os.RemoveAll(assembledDir)
	_ = os.Remove(filepath.Dir(assembledDir))

	_ = w.queue.SetJobStatus(context.Background(), job.ID, "completed")
	webhook.NotifyJobStatus(webhook.Payload{
		JobID:      job.ID,
		Status:     "completed",
		UploadID:   job.UploadID,
		UserID:     job.UserID,
		FileName:   job.FileName,
		FileSize:   job.FileSize,
		Endpoint:   videoEndpoint,
		Thumbnails: thumbnailPaths,
		Duration:   videoDuration,
		IsAdult:    &isAdult,
	})
	w.log.Infof("job complete job=%s user=%s upload=%s duration=%s thumbnails=%d", job.ID, job.UserID, job.UploadID, time.Since(start), len(thumbnailPaths))
}

func isVideo(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".mp4", ".webm", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".m4v":
		return true
	}
	return false
}

func isImage(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp":
		return true
	}
	return false
}
