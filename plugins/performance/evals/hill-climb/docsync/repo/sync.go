package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const defaultManifest = "https://releases.example.org/api/manifest.json"

type Package struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Archive string `json:"archive"`
	SHA256  string `json:"sha256"`
}

type Manifest struct {
	Release  string    `json:"release"`
	Packages []Package `json:"packages"`
}

func run(manifestRef, dir string) error {
	start := time.Now()
	m, err := loadManifest(manifestRef)
	if err != nil {
		return err
	}
	lockPath := filepath.Join(dir, "docsync.lock")
	lock, err := readLock(lockPath)
	if err != nil {
		return err
	}
	changed := lock.changed(m)
	phase("resolve", start, "%d of %d packages changed", len(changed), len(m.Packages))
	if len(changed) == 0 {
		fmt.Println("up to date with", m.Release)
		return nil
	}

	t := time.Now()
	archives := make([]string, len(changed))
	for i, p := range changed {
		path, err := fetch(p)
		if err != nil {
			return fmt.Errorf("fetch %s: %w", p.Name, err)
		}
		archives[i] = path
	}
	phase("fetch", t, "%d archives", len(changed))

	t = time.Now()
	pages := 0
	for i, p := range changed {
		n, err := apply(dir, p, archives[i])
		if err != nil {
			return fmt.Errorf("apply %s: %w", p.Name, err)
		}
		pages += n
	}
	r := time.Now()
	if err := relink(dir); err != nil {
		return err
	}
	phase("apply", t, "%d packages, %d pages, relink %.2fs", len(changed), pages, time.Since(r).Seconds())

	t = time.Now()
	if err := buildIndex(dir); err != nil {
		return err
	}
	phase("index", t, "")

	fmt.Fprintf(os.Stderr, "docsync: synced %s in %.2fs\n", m.Release, time.Since(start).Seconds())
	return lock.update(lockPath, m)
}

func loadManifest(ref string) (Manifest, error) {
	var m Manifest
	var body io.ReadCloser
	if strings.HasPrefix(ref, "https://") {
		resp, err := http.Get(ref)
		if err != nil {
			return m, err
		}
		body = resp.Body
	} else {
		f, err := os.Open(ref)
		if err != nil {
			return m, err
		}
		body = f
	}
	defer body.Close()
	return m, json.NewDecoder(body).Decode(&m)
}

func phase(name string, start time.Time, format string, args ...any) {
	detail := fmt.Sprintf(format, args...)
	if detail != "" {
		detail = " (" + detail + ")"
	}
	fmt.Fprintf(os.Stderr, "docsync: %s %.2fs%s\n", name, time.Since(start).Seconds(), detail)
}
