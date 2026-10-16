package main

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
)

// Cache stores build products on disk by key, so a rebuild skips the work.
type Cache struct{ dir string }

func NewCache(dir string) *Cache { return &Cache{dir: dir} }

func (c *Cache) path(key string) string {
	return filepath.Join(c.dir, hash([]byte(key)))
}

func (c *Cache) Get(key string) ([]byte, bool) {
	data, err := os.ReadFile(c.path(key))
	return data, err == nil
}

func (c *Cache) Put(key string, data []byte) error {
	if err := os.MkdirAll(c.dir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(c.path(key), data, 0o644)
}

func hash(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
