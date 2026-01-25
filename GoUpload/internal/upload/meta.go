package upload

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"
)

func writeMeta(path string, meta UploadMeta) error {
	meta.ReceivedChunks = normalizeChunks(meta.ReceivedChunks)
	meta.LastActivity = time.Now().UTC()
	tempFile, err := os.CreateTemp(filepath.Dir(path), "meta-*.tmp")
	if err != nil {
		return err
	}
	enc := json.NewEncoder(tempFile)
	if err := enc.Encode(meta); err != nil {
		_ = tempFile.Close()
		_ = os.Remove(tempFile.Name())
		return err
	}
	if err := tempFile.Close(); err != nil {
		_ = os.Remove(tempFile.Name())
		return err
	}
	_ = os.Remove(path)
	return os.Rename(tempFile.Name(), path)
}

func readMeta(path string) (UploadMeta, error) {
	file, err := os.Open(path)
	if err != nil {
		return UploadMeta{}, err
	}
	defer file.Close()
	var meta UploadMeta
	if err := json.NewDecoder(file).Decode(&meta); err != nil {
		return UploadMeta{}, err
	}
	return meta, nil
}

func metaPath(baseDir, userID, uploadID string) string {
	return filepath.Join(baseDir, userID, uploadID, "meta.json")
}

func chunkPath(baseDir, userID, uploadID string, index int) string {
	name := fmt.Sprintf("chunk_%05d", index)
	return filepath.Join(baseDir, userID, uploadID, name)
}

func normalizeChunks(chunks []int) []int {
	if len(chunks) == 0 {
		return chunks
	}
	unique := make(map[int]struct{}, len(chunks))
	for _, c := range chunks {
		unique[c] = struct{}{}
	}
	out := make([]int, 0, len(unique))
	for k := range unique {
		out = append(out, k)
	}
	sort.Ints(out)
	return out
}

func findExistingMeta(baseDir, userID, fileName string, fileSize int64) (UploadMeta, error) {
	userDir := filepath.Join(baseDir, userID)
	entries, err := os.ReadDir(userDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return UploadMeta{}, os.ErrNotExist
		}
		return UploadMeta{}, err
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		path := filepath.Join(userDir, entry.Name(), "meta.json")
		meta, err := readMeta(path)
		if err != nil {
			continue
		}
		if meta.FileName == fileName && meta.FileSize == fileSize && len(meta.ReceivedChunks) < meta.TotalChunks {
			return meta, nil
		}
	}
	return UploadMeta{}, os.ErrNotExist
}
