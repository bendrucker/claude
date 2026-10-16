package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
)

// fetch downloads one package archive into the cache directory and verifies its digest.
func fetch(p Package) (string, error) {
	cache, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	path := filepath.Join(cache, "docsync", p.SHA256+".tar.gz")
	if _, err := os.Stat(path); err == nil {
		return path, nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", err
	}
	resp, err := http.Get(p.Archive)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("GET %s: %s", p.Archive, resp.Status)
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), "fetch-*")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name())
	h := sha256.New()
	if _, err := io.Copy(io.MultiWriter(tmp, h), resp.Body); err != nil {
		tmp.Close()
		return "", err
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != p.SHA256 {
		return "", fmt.Errorf("digest %s, want %s", got, p.SHA256)
	}
	return path, os.Rename(tmp.Name(), path)
}
