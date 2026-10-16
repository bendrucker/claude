package main

import (
	"bufio"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

type entry struct {
	Title string `json:"title"`
	Path  string `json:"path"`
}

// buildIndex writes the search index the site loads: one entry per page title.
func buildIndex(dir string) error {
	var entries []entry
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".md") {
			return err
		}
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()
		first := bufio.NewScanner(f)
		if first.Scan() {
			rel, _ := filepath.Rel(dir, path)
			entries = append(entries, entry{strings.TrimPrefix(first.Text(), "# "), rel})
		}
		return first.Err()
	})
	if err != nil {
		return err
	}
	data, err := json.Marshal(entries)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "search-index.json"), data, 0o644)
}
