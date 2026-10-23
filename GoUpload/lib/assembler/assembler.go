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

	outputPath := OutputPath(cfg)
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

// OutputPath is where Assemble writes an upload's file.
func OutputPath(cfg Config) string {
	return filepath.Join(cfg.OutputDir, cfg.UserID, cfg.UploadID+"_"+cfg.FileName)
}

// Previous returns the file an earlier run already assembled, for a job picked
// up again after a restart. Only once its chunks are gone: the worker deletes
// them right after a good assembly, so until then the file may be half written
// and assembling again is the safe choice.
func Previous(cfg Config) (Result, bool) {
	if _, err := os.Stat(filepath.Join(cfg.ChunksDir, cfg.UserID, cfg.UploadID)); err == nil {
		return Result{}, false
	}
	outputPath := OutputPath(cfg)
	st, err := os.Stat(outputPath)
	if err != nil || !st.Mode().IsRegular() || st.Size() == 0 {
		return Result{}, false
	}
	return Result{OutputPath: outputPath, FileSize: st.Size()}, true
}

// Resumable reports whether a job can run again from what is on disk: either
// its assembled file, or every one of its chunks.
func Resumable(cfg Config) bool {
	if _, ok := Previous(cfg); ok {
		return true
	}
	_, err := listChunks(filepath.Join(cfg.ChunksDir, cfg.UserID, cfg.UploadID), cfg.TotalChunks)
	return err == nil
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
