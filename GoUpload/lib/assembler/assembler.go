package assembler

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
)

type Config struct {
	ChunksDir   string
	OutputDir   string
	UserID      string
	UploadID    string
	FileName    string
	TotalChunks int
}

type Result struct {
	OutputPath string
	FileSize   int64
}

func Assemble(cfg Config) (Result, error) {
	if err := os.MkdirAll(cfg.OutputDir, 0700); err != nil {
		return Result{}, fmt.Errorf("create output dir: %w", err)
	}

	chunkDir := filepath.Join(cfg.ChunksDir, cfg.UserID, cfg.UploadID)
	chunks, err := listChunks(chunkDir, cfg.TotalChunks)
	if err != nil {
		return Result{}, fmt.Errorf("list chunks: %w", err)
	}

	outputPath := filepath.Join(cfg.OutputDir, cfg.UserID, cfg.UploadID+"_"+cfg.FileName)
	if err := os.MkdirAll(filepath.Dir(outputPath), 0700); err != nil {
		return Result{}, fmt.Errorf("create user output dir: %w", err)
	}

	outFile, err := os.OpenFile(outputPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return Result{}, fmt.Errorf("create output file: %w", err)
	}
	defer outFile.Close()

	var totalSize int64
	for _, chunkPath := range chunks {
		written, err := appendChunk(outFile, chunkPath)
		if err != nil {
			_ = os.Remove(outputPath)
			return Result{}, fmt.Errorf("append chunk %s: %w", chunkPath, err)
		}
		totalSize += written
	}

	if err := outFile.Sync(); err != nil {
		return Result{}, fmt.Errorf("sync output: %w", err)
	}

	return Result{OutputPath: outputPath, FileSize: totalSize}, nil
}

func Cleanup(chunksDir, userID, uploadID string) error {
	uploadDir := filepath.Join(chunksDir, userID, uploadID)
	return os.RemoveAll(uploadDir)
}

func listChunks(dir string, total int) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	chunks := make([]string, 0, total)
	for _, entry := range entries {
		if entry.IsDir() || entry.Name() == "meta.json" {
			continue
		}
		chunks = append(chunks, filepath.Join(dir, entry.Name()))
	}

	if len(chunks) != total {
		return nil, fmt.Errorf("expected %d chunks, found %d", total, len(chunks))
	}

	sort.Strings(chunks)
	return chunks, nil
}

func appendChunk(dst *os.File, chunkPath string) (int64, error) {
	src, err := os.Open(chunkPath)
	if err != nil {
		return 0, err
	}
	defer src.Close()
	return io.Copy(dst, src)
}
