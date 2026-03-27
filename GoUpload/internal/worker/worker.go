package worker

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"goupload/internal/upload"
	"goupload/lib/assembler"
	"goupload/lib/colors"
	"goupload/lib/ffmpeg"
	ghlib "goupload/lib/github"
	"goupload/lib/logger"
	"goupload/lib/nsfw"
	"goupload/lib/queue"
	"goupload/lib/webhook"

	"github.com/google/go-github/v62/github"
)

type Config struct {
	ChunksDir     string
	OutputDir     string
	TempDir       string
	HLSDir        string
	ThumbnailDir  string
	NSFWApiURL    string
	NSFWApiSecret string // X-Webhook-Secret for app /api/nsfw/detect; often UPLOAD_WEBHOOK_SECRET
	// GitHub: if GitHubClient is nil, uploads to GitHub are skipped.
	GitHubClient *github.Client
	GitHubOwner  string
	GitHubRepo   string
}

type Worker struct {
	queue  *queue.Client
	log    *logger.Logger
	nsfw   *nsfw.Detector
	cfg    Config
	stopCh chan struct{}
	wg     sync.WaitGroup
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
	var lastOrphanCleanup time.Time

	for {
		select {
		case <-w.stopCh:
			w.log.Infof("worker stopping")
			return
		default:
		}

		if lastOrphanCleanup.IsZero() || time.Since(lastOrphanCleanup) > 30*time.Minute {
			if n, err := upload.CleanupOrphanedChunks(w.cfg.ChunksDir, 24*time.Hour); err == nil && n > 0 {
				w.log.Infof("orphan chunk cleanup removed %d dirs", n)
			}
			lastOrphanCleanup = time.Now()
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

func (w *Worker) failJob(job *queue.Job, reason string, cleanupPaths ...string) {
	w.log.Errorf("job FAILED job=%s reason=%s", job.ID, reason)
	for _, p := range cleanupPaths {
		if p == "" {
			continue
		}
		_ = os.RemoveAll(p)
	}
	_ = w.queue.SetJobStatus(context.Background(), job.ID, "failed")
	webhook.NotifyJobStatus(webhook.Payload{JobID: job.ID, Status: "failed", UploadID: job.UploadID, UserID: job.UserID, FileName: job.FileName, FileSize: job.FileSize})
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
		_ = assembler.Cleanup(w.cfg.ChunksDir, job.UserID, job.UploadID)
		_ = os.Remove(filepath.Join(w.cfg.ChunksDir, job.UserID))
		_ = w.queue.SetJobStatus(context.Background(), job.ID, "failed")
		webhook.NotifyJobStatus(webhook.Payload{JobID: job.ID, Status: "failed", UploadID: job.UploadID, UserID: job.UserID, FileName: job.FileName, FileSize: job.FileSize})
		return
	}
	w.log.Infof("assembled job=%s output=%s size=%d", job.ID, result.OutputPath, result.FileSize)

	if result.FileSize == 0 {
		assembledDir := filepath.Dir(result.OutputPath)
		_ = assembler.Cleanup(w.cfg.ChunksDir, job.UserID, job.UploadID)
		w.failJob(job, "assembled file is empty (0 bytes)", result.OutputPath, assembledDir, filepath.Dir(assembledDir))
		return
	}

	if err := assembler.Cleanup(w.cfg.ChunksDir, job.UserID, job.UploadID); err != nil {
		w.log.Errorf("chunk cleanup failed job=%s err=%s", job.ID, err.Error())
	} else {
		_ = os.Remove(filepath.Join(w.cfg.ChunksDir, job.UserID))
	}

	if !isVideo(job.FileName) && !isImage(job.FileName) {
		assembledDir := filepath.Dir(result.OutputPath)
		w.failJob(job, "unsupported file type: "+job.FileName, result.OutputPath, assembledDir, filepath.Dir(assembledDir))
		return
	}

	if !isVideo(job.FileName) {
		w.log.Infof("image file, validating job=%s", job.ID)

		if !validateImageFile(result.OutputPath) {
			assembledDir := filepath.Dir(result.OutputPath)
			w.failJob(job, "file is not a valid image (corrupt or wrong format)", result.OutputPath, assembledDir, filepath.Dir(assembledDir))
			return
		}
		w.log.Infof("image validated job=%s", job.ID)

		dateFolder := ghlib.DateFolder(time.Now())
		ghPath := dateFolder + "/" + job.UploadID + "/" + job.FileName
		if err := ghlib.UploadLocalFile(context.Background(), w.cfg.GitHubClient, w.cfg.GitHubOwner, w.cfg.GitHubRepo, ghPath, result.OutputPath, "Upload "+job.FileName); err != nil {
			w.log.Errorf("github upload failed job=%s path=%s err=%s", job.ID, ghPath, err.Error())
			_ = w.queue.SetJobStatus(context.Background(), job.ID, "failed")
			webhook.NotifyJobStatus(webhook.Payload{JobID: job.ID, Status: "failed", UploadID: job.UploadID, UserID: job.UserID, FileName: job.FileName, FileSize: job.FileSize})
			return
		}
		w.log.Infof("github uploaded job=%s path=%s", job.ID, ghPath)

		isAdult := false
		var imgColors []string
		var categories, tags []string
		var metadata map[string]interface{}

		if isImage(job.FileName) && result.FileSize > 0 && result.FileSize <= 25*1024*1024 {
			data, rerr := os.ReadFile(result.OutputPath)
			if rerr != nil {
				assembledDir := filepath.Dir(result.OutputPath)
				w.failJob(job, "failed to read file for vision check: "+rerr.Error(), result.OutputPath, assembledDir, filepath.Dir(assembledDir))
				return
			}

			visionRes, derr := w.nsfw.Detect(data)
			if derr != nil {
				assembledDir := filepath.Dir(result.OutputPath)
				w.failJob(job, "vision detection failed: "+derr.Error(), result.OutputPath, assembledDir, filepath.Dir(assembledDir))
				return
			}
			isAdult = visionRes.IsNSFW
			categories, tags, metadata = buildVisionData(&visionRes, job.Title, job.Description, job.UserCategories, job.UserTags)
			w.log.Infof("vision check job=%s adult=%v labels=%d", job.ID, isAdult, len(visionRes.Labels))

			extracted, cerr := colors.ExtractDominant(data, 6)
			if cerr != nil {
				w.log.Errorf("color extraction failed job=%s err=%s (continuing)", job.ID, cerr.Error())
			} else {
				imgColors = extracted
				w.log.Infof("colors extracted job=%s count=%d", job.ID, len(imgColors))
			}
		}

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
			Endpoint:   ghPath,
			IsAdult:    &isAdult,
			Colors:     imgColors,
			Categories: categories,
			Tags:       tags,
			Metadata:   metadata,
			Series: webhook.SeriesPayload{
				SeriesID:       job.Series.SeriesID,
				SeriesTitle:    job.Series.SeriesTitle,
				SeriesDesc:     job.Series.SeriesDesc,
				SeriesIsPublic: job.Series.SeriesIsPublic,
				IsSeriesMain:   job.Series.IsSeriesMain,
				EpisodeNumber:  job.Series.EpisodeNumber,
				SeasonNumber:   job.Series.SeasonNumber,
			},
		})
		w.log.Infof("job complete job=%s duration=%s", job.ID, time.Since(start))
		return
	}

	thumbDir := filepath.Join(w.cfg.ThumbnailDir, job.UserID, job.UploadID)
	thumbResult, err := ffmpeg.ExtractThumbnails(result.OutputPath, thumbDir)
	if err != nil {
		assembledDir := filepath.Dir(result.OutputPath)
		w.failJob(job, "thumbnail extraction failed (broken video): "+err.Error(), result.OutputPath, assembledDir, filepath.Dir(assembledDir), thumbDir, filepath.Dir(thumbDir))
		return
	} else {
		w.log.Infof("extracted %d thumbnails job=%s duration=%.2fs", len(thumbResult.Thumbnails), job.ID, thumbResult.Duration)

		previewPath, metaPath, perr := ffmpeg.BuildThumbnailPreview(thumbDir, thumbResult)
		if perr != nil {
			w.log.Errorf("thumbnail preview failed job=%s err=%s", job.ID, perr.Error())
		} else {
			w.log.Infof("thumbnail_preview job=%s preview=%s meta=%s", job.ID, previewPath, metaPath)
		}

		waveformPath, werr := ffmpeg.ExtractWaveform(result.OutputPath, thumbDir)
		if werr != nil {
			w.log.Infof("waveform extraction skipped job=%s err=%s", job.ID, werr.Error())
		} else {
			w.log.Infof("waveforms job=%s path=%s", job.ID, waveformPath)
		}
	}

	isAdult := false
	var vidColors []string
	var categories, tags []string
	var metadata map[string]interface{}

	if verr := ffmpeg.ValidateVideo(result.OutputPath); verr != nil {
		assembledDir := filepath.Dir(result.OutputPath)
		w.failJob(job, "broken video file: "+verr.Error(), result.OutputPath, assembledDir, filepath.Dir(assembledDir), thumbDir, filepath.Dir(thumbDir))
		return
	}
	w.log.Infof("video validated job=%s", job.ID)

	videoInfo, probeErr := ffmpeg.ProbeVideo(result.OutputPath)
	if probeErr != nil {
		assembledDir := filepath.Dir(result.OutputPath)
		w.failJob(job, "cannot read video metadata: "+probeErr.Error(), result.OutputPath, assembledDir, filepath.Dir(assembledDir), thumbDir, filepath.Dir(thumbDir))
		return
	} else {
		w.log.Infof("probe job=%s %dx%d aspect=%s codec=%s fps=%.2f audio=%s/%dHz/%dch",
			job.ID, videoInfo.Width, videoInfo.Height, videoInfo.AspectRatio,
			videoInfo.Codec, videoInfo.Fps, videoInfo.AudioCodec,
			videoInfo.AudioSampleRate, videoInfo.AudioChannels)
	}

	var loudnessInfo *ffmpeg.LoudnessInfo
	loudnessInfo, err = ffmpeg.ProbeLoudness(result.OutputPath)
	if err != nil {
		w.log.Errorf("loudness analysis failed job=%s err=%s (continuing)", job.ID, err.Error())
	} else {
		w.log.Infof("loudness job=%s integrated=%.1f LUFS peak=%.1f dBTP range=%.1f LU",
			job.ID, loudnessInfo.IntegratedLoudness, loudnessInfo.TruePeak, loudnessInfo.LoudnessRange)
	}

	if thumbResult != nil && len(thumbResult.Thumbnails) > 0 {
		count := len(thumbResult.Thumbnails)
		var subset [][]byte
		if count <= 3 {
			for _, t := range thumbResult.Thumbnails {
				subset = append(subset, t.Data)
			}
		} else {
			subset = append(subset, thumbResult.Thumbnails[0].Data)
			subset = append(subset, thumbResult.Thumbnails[count/2].Data)
			subset = append(subset, thumbResult.Thumbnails[count-1].Data)
		}
		w.log.Infof("vision sampling %d of %d thumbnails job=%s", len(subset), count, job.ID)

		var visionResult *nsfw.Result
		isAdult, visionResult, err = w.nsfw.DetectBatch(subset)
		if err != nil {
			assembledDir := filepath.Dir(result.OutputPath)
			w.failJob(job, "vision detection failed: "+err.Error(), result.OutputPath, assembledDir, filepath.Dir(assembledDir), thumbDir, filepath.Dir(thumbDir))
			return
		}
		w.log.Infof("vision check job=%s adult=%v (checked %d frames)", job.ID, isAdult, len(subset))
		if visionResult != nil {
			categories, tags, metadata = buildVisionData(visionResult, job.Title, job.Description, job.UserCategories, job.UserTags)
		}

		var colorSample [][]byte
		colorStep := 1
		if len(thumbResult.Thumbnails) > 5 {
			colorStep = len(thumbResult.Thumbnails) / 5
		}
		for i := 0; i < len(thumbResult.Thumbnails) && len(colorSample) < 5; i += colorStep {
			colorSample = append(colorSample, thumbResult.Thumbnails[i].Data)
		}
		vidColors = colors.ExtractFromMultiple(colorSample, 6)
		w.log.Infof("colors extracted job=%s count=%d", job.ID, len(vidColors))
	}

	if metadata == nil {
		metadata = make(map[string]interface{})
	}
	if videoInfo != nil {
		metadata["video"] = map[string]interface{}{
			"width":        videoInfo.Width,
			"height":       videoInfo.Height,
			"aspect_ratio": videoInfo.AspectRatio,
			"codec":        videoInfo.Codec,
			"fps":          videoInfo.Fps,
			"bitrate":      videoInfo.Bitrate,
		}
		metadata["audio"] = map[string]interface{}{
			"codec":       videoInfo.AudioCodec,
			"bitrate":     videoInfo.AudioBitrate,
			"sample_rate": videoInfo.AudioSampleRate,
			"channels":    videoInfo.AudioChannels,
		}
	}
	if loudnessInfo != nil {
		metadata["loudness"] = map[string]interface{}{
			"integrated_lufs": loudnessInfo.IntegratedLoudness,
			"true_peak_dbtp":  loudnessInfo.TruePeak,
			"range_lu":        loudnessInfo.LoudnessRange,
		}
	}

	hlsDir := filepath.Join(w.cfg.HLSDir, job.UserID, job.UploadID)
	hlsAll, err := ffmpeg.ConvertToHLSAllQualities(result.OutputPath, hlsDir, ffmpeg.HLSOptions{
		SegmentTime: 10,
	})
	if err != nil {
		assembledDir := filepath.Dir(result.OutputPath)
		w.failJob(job, "hls conversion failed: "+err.Error(), result.OutputPath, assembledDir, filepath.Dir(assembledDir), hlsDir, filepath.Dir(hlsDir), thumbDir, filepath.Dir(thumbDir))
		return
	} else {
		tierNames := make([]string, len(hlsAll.Tiers))
		for i, t := range hlsAll.Tiers {
			tierNames[i] = fmt.Sprintf("%s(%d segs)", t.TierName, len(t.SegmentFiles))
		}
		w.log.Infof("hls job=%s tiers=[%s]", job.ID, strings.Join(tierNames, ", "))
	}

	// If user provided a default thumbnail, decode and save it to the thumbDir
	// so it gets included in the batch upload with a consistent name
	defaultThumbPath := ""
	if job.DefaultThumbnail != "" {
		thumbData, derr := base64.StdEncoding.DecodeString(job.DefaultThumbnail)
		if derr != nil {
			w.log.Errorf("failed to decode default thumbnail job=%s err=%s", job.ID, derr.Error())
		} else {
			dtPath := filepath.Join(thumbDir, "default_thumbnail.jpg")
			if werr := os.WriteFile(dtPath, thumbData, 0644); werr != nil {
				w.log.Errorf("failed to write default thumbnail job=%s err=%s", job.ID, werr.Error())
			} else {
				w.log.Infof("default thumbnail saved job=%s path=%s", job.ID, dtPath)
				defaultThumbPath = "default_thumbnail.jpg"
			}
		}
	}

	dateFolder := ghlib.DateFolder(time.Now())
	ghPrefix := dateFolder + "/" + job.UploadID + "/"
	videoEndpoint := ""
	var thumbnailPaths []string
	var videoDuration float64

	// Collect all files for a single batch commit (Git Data API: blobs→tree→commit)
	var batchFiles []ghlib.BatchFile

	if hlsAll != nil {
		hlsFiles, cerr := ghlib.CollectDir(hlsDir, ghPrefix)
		if cerr != nil {
			w.failJob(job, "collect hls files: "+cerr.Error(), result.OutputPath, filepath.Dir(result.OutputPath), filepath.Dir(filepath.Dir(result.OutputPath)), hlsDir, filepath.Dir(hlsDir), thumbDir, filepath.Dir(thumbDir))
			return
		}
		batchFiles = append(batchFiles, hlsFiles...)
		videoEndpoint = dateFolder + "/" + job.UploadID + "/master.m3u8"
		w.log.Infof("collected %d hls files job=%s", len(hlsFiles), job.ID)
	}

	if thumbResult != nil {
		videoDuration = thumbResult.Duration
		thumbFiles, cerr := ghlib.CollectDirFlat(thumbDir, ghPrefix)
		if cerr != nil {
			w.failJob(job, "collect thumbnail files: "+cerr.Error(), result.OutputPath, filepath.Dir(result.OutputPath), filepath.Dir(filepath.Dir(result.OutputPath)), hlsDir, filepath.Dir(hlsDir), thumbDir, filepath.Dir(thumbDir))
			return
		}
		batchFiles = append(batchFiles, thumbFiles...)
		for i := range thumbResult.Thumbnails {
			thumbnailPaths = append(thumbnailPaths, ghPrefix+filepath.Base(thumbResult.Thumbnails[i].Path))
		}
		thumbnailPaths = append(thumbnailPaths, ghPrefix+"thumbnail_preview.jpg")
		thumbnailPaths = append(thumbnailPaths, ghPrefix+"thumbnail_preview.json")
		w.log.Infof("collected %d thumbnail files job=%s", len(thumbFiles), job.ID)
	}

	if len(batchFiles) > 0 {
		ghBranch := os.Getenv("GITHUB_BRANCH")
		if ghBranch == "" {
			ghBranch = "main"
		}
		if err := ghlib.BatchCommit(context.Background(), w.cfg.GitHubClient, w.cfg.GitHubOwner, w.cfg.GitHubRepo, ghBranch, "Upload "+job.UploadID, batchFiles, 4, w.log.Infof); err != nil {
			w.log.Errorf("github batch upload failed job=%s files=%d err=%s", job.ID, len(batchFiles), err.Error())
			_ = os.RemoveAll(hlsDir)
			_ = os.Remove(filepath.Dir(hlsDir))
			_ = os.RemoveAll(thumbDir)
			_ = os.Remove(filepath.Dir(thumbDir))
			_ = os.Remove(result.OutputPath)
			_ = os.RemoveAll(filepath.Dir(result.OutputPath))
			_ = os.Remove(filepath.Dir(filepath.Dir(result.OutputPath)))
			_ = w.queue.SetJobStatus(context.Background(), job.ID, "failed")
			webhook.NotifyJobStatus(webhook.Payload{JobID: job.ID, Status: "failed", UploadID: job.UploadID, UserID: job.UserID, FileName: job.FileName, FileSize: job.FileSize})
			return
		}
		w.log.Infof("github batch uploaded job=%s files=%d", job.ID, len(batchFiles))
	}

	// Cleanup local HLS + thumbnail dirs
	_ = os.RemoveAll(hlsDir)
	_ = os.Remove(filepath.Dir(hlsDir))
	_ = os.Remove(w.cfg.HLSDir)
	_ = os.RemoveAll(thumbDir)
	_ = os.Remove(filepath.Dir(thumbDir))
	_ = os.Remove(w.cfg.ThumbnailDir)

	// Cleanup: remove assembled file, uploadID dir, and empty user dir
	if err := os.Remove(result.OutputPath); err != nil {
		w.log.Errorf("cleanup assembled file failed job=%s err=%s", job.ID, err.Error())
	} else {
		w.log.Infof("cleanup assembled file job=%s path=%s", job.ID, result.OutputPath)
	}
	assembledDir := filepath.Dir(result.OutputPath)
	_ = os.RemoveAll(assembledDir)
	_ = os.Remove(filepath.Dir(assembledDir))

	// Build default thumbnail GitHub path
	defaultThumbGH := ""
	if defaultThumbPath != "" {
		defaultThumbGH = ghPrefix + defaultThumbPath
	}

	_ = w.queue.SetJobStatus(context.Background(), job.ID, "completed")
	webhook.NotifyJobStatus(webhook.Payload{
		JobID:            job.ID,
		Status:           "completed",
		UploadID:         job.UploadID,
		UserID:           job.UserID,
		FileName:         job.FileName,
		FileSize:         job.FileSize,
		Endpoint:         videoEndpoint,
		Thumbnails:       thumbnailPaths,
		Duration:         videoDuration,
		IsAdult:          &isAdult,
		Colors:           vidColors,
		Categories:       categories,
		Tags:             tags,
		Metadata:         metadata,
		DefaultThumbnail: defaultThumbGH,
		Series: webhook.SeriesPayload{
			SeriesID:       job.Series.SeriesID,
			SeriesTitle:    job.Series.SeriesTitle,
			SeriesDesc:     job.Series.SeriesDesc,
			SeriesIsPublic: job.Series.SeriesIsPublic,
			IsSeriesMain:   job.Series.IsSeriesMain,
			EpisodeNumber:  job.Series.EpisodeNumber,
			SeasonNumber:   job.Series.SeasonNumber,
		},
	})
	w.log.Infof("job complete job=%s user=%s upload=%s duration=%s thumbnails=%d colors=%d tags=%d", job.ID, job.UserID, job.UploadID, time.Since(start), len(thumbnailPaths), len(vidColors), len(tags))
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

func validateImageFile(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()

	header := make([]byte, 16)
	n, err := f.Read(header)
	if err != nil || n < 4 {
		return false
	}

	if header[0] == 0xFF && header[1] == 0xD8 && header[2] == 0xFF {
		return true
	}
	if header[0] == 0x89 && header[1] == 0x50 && header[2] == 0x4E && header[3] == 0x47 {
		return true
	}
	if header[0] == 0x47 && header[1] == 0x49 && header[2] == 0x46 {
		return true
	}
	if n >= 12 && header[0] == 0x52 && header[1] == 0x49 && header[2] == 0x46 && header[3] == 0x46 &&
		header[8] == 0x57 && header[9] == 0x45 && header[10] == 0x42 && header[11] == 0x50 {
		return true
	}
	if header[0] == 0x42 && header[1] == 0x4D {
		return true
	}

	return false
}

var categoryKeywords = map[string][]string{
	"Gaming":        {"game", "gaming", "gameplay", "playthrough", "walkthrough", "fortnite", "minecraft", "valorant", "roblox", "gta", "cod", "apex", "league", "overwatch", "fps", "rpg", "mmorpg", "esports", "speedrun", "stream", "twitch"},
	"Music":         {"music", "song", "beat", "remix", "cover", "acoustic", "instrumental", "rap", "hiphop", "hip-hop", "r&b", "pop", "rock", "edm", "lofi", "lo-fi", "playlist", "album", "lyric", "vocals", "dj", "producer"},
	"Entertainment": {"funny", "comedy", "meme", "skit", "prank", "reaction", "challenge", "vlog", "storytime", "drama", "celebrity", "trending", "viral"},
	"Education":     {"tutorial", "how to", "howto", "learn", "course", "lecture", "explained", "guide", "lesson", "study", "tips", "educational", "science", "history", "math"},
	"Technology":    {"tech", "review", "unboxing", "setup", "pc", "phone", "laptop", "software", "hardware", "coding", "programming", "ai", "robot", "gadget", "apple", "android", "windows"},
	"Sports":        {"sport", "football", "soccer", "basketball", "baseball", "tennis", "boxing", "mma", "ufc", "nba", "nfl", "fifa", "workout", "gym", "fitness", "training", "highlights"},
	"News":          {"news", "breaking", "politics", "election", "update", "report", "journalist", "interview", "debate", "analysis"},
	"Lifestyle":     {"lifestyle", "fashion", "beauty", "makeup", "skincare", "outfit", "haul", "cooking", "recipe", "food", "travel", "vacation", "diy", "home", "decor", "asmr"},
	"Anime":         {"anime", "manga", "otaku", "weeb", "naruto", "one piece", "dragon ball", "attack on titan", "demon slayer", "jujutsu", "cosplay", "waifu"},
	"Film":          {"movie", "film", "trailer", "cinema", "review", "scene", "actor", "director", "netflix", "series", "tv show", "episode", "season"},
	"Automotive":    {"car", "cars", "drift", "racing", "engine", "turbo", "exhaust", "jdm", "supercar", "hypercar", "motorcycle", "bike", "mod", "wrap"},
	"Art":           {"art", "drawing", "painting", "sketch", "digital art", "illustration", "timelapse", "creative", "design", "animation", "3d", "blender"},
	"Nature":        {"nature", "animal", "wildlife", "ocean", "mountain", "forest", "sunset", "landscape", "garden", "pet", "dog", "cat"},
}

func buildVisionData(vr *nsfw.Result, title, description string, userCategories, userTags []string) (categories []string, tags []string, metadata map[string]interface{}) {
	metadata = make(map[string]interface{})
	seen := make(map[string]bool)

	for _, uc := range userCategories {
		uc = strings.TrimSpace(uc)
		if uc != "" && !seen[uc] {
			categories = append(categories, uc)
			seen[uc] = true
		}
	}
	for _, ut := range userTags {
		ut = strings.TrimSpace(ut)
		if ut != "" && !seen[ut] {
			tags = append(tags, ut)
			seen[ut] = true
		}
	}

	if vr.Description != "" {
		metadata["description"] = vr.Description
	}

	if vr.SafeSearch != nil {
		metadata["safeSearch"] = map[string]string{
			"adult":    vr.SafeSearch.Adult,
			"violence": vr.SafeSearch.Violence,
			"racy":     vr.SafeSearch.Racy,
			"spoof":    vr.SafeSearch.Spoof,
			"medical":  vr.SafeSearch.Medical,
		}
	}

	var labelNames []string
	if len(vr.Labels) > 0 {
		var rawLabels []map[string]interface{}
		for _, l := range vr.Labels {
			rawLabels = append(rawLabels, map[string]interface{}{
				"name":  l.Name,
				"score": l.Score,
			})
			labelNames = append(labelNames, strings.ToLower(l.Name))
			if l.Score >= 0.80 && !seen[l.Name] {
				categories = append(categories, l.Name)
				seen[l.Name] = true
			}
			if l.Score >= 0.50 && !seen[l.Name] {
				tags = append(tags, l.Name)
				seen[l.Name] = true
			}
		}
		metadata["labels"] = rawLabels
		metadata["labelNames"] = labelNames
	}

	combined := strings.ToLower(title + " " + description)
	var matchedCategories []string

	for category, keywords := range categoryKeywords {
		for _, kw := range keywords {
			if strings.Contains(combined, kw) {
				matchedCategories = append(matchedCategories, category)
				if !seen[category] {
					categories = append(categories, category)
					seen[category] = true
				}
				break
			}
		}
	}

	if title != "" || description != "" {
		metadata["textAnalysis"] = map[string]interface{}{
			"title":             title,
			"description":       description,
			"matchedCategories": matchedCategories,
		}
	}

	return categories, tags, metadata
}
