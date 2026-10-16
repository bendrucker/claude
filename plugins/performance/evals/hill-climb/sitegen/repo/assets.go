package main

import (
	"bytes"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var widths = []int{480, 960, 1920}

func isImage(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".png" || ext == ".jpg" || ext == ".jpeg"
}

// writeImage writes one resized JPEG per width, reusing cached results by
// content hash.
func writeImage(path, content, out string, cache *Cache) error {
	src, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	rel, _ := filepath.Rel(content, path)
	base := strings.TrimSuffix(rel, filepath.Ext(rel))
	for _, w := range widths {
		key := fmt.Sprintf("img:%d:%s", w, hash(src))
		data, ok := cache.Get(key)
		if !ok {
			data, err = resize(src, w)
			if err != nil {
				return fmt.Errorf("%s: %w", path, err)
			}
			if err := cache.Put(key, data); err != nil {
				return err
			}
		}
		dst := filepath.Join(out, fmt.Sprintf("%s-%d.jpg", base, w))
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(dst, data, 0o644); err != nil {
			return err
		}
	}
	return nil
}

func resize(src []byte, width int) ([]byte, error) {
	img, _, err := image.Decode(bytes.NewReader(src))
	if err != nil {
		return nil, err
	}
	b := img.Bounds()
	height := b.Dy() * width / b.Dx()
	dst := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			dst.Set(x, y, img.At(b.Min.X+x*b.Dx()/width, b.Min.Y+y*b.Dy()/height))
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 82}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

var include = regexp.MustCompile(`\{\{< remote "([^"]+)" >\}\}`)

// expandIncludes replaces each remote include with the fetched document,
// cached by URL.
func expandIncludes(src []byte, cache *Cache) ([]byte, error) {
	var ferr error
	out := include.ReplaceAllFunc(src, func(m []byte) []byte {
		url := string(include.FindSubmatch(m)[1])
		if data, ok := cache.Get("remote:" + url); ok {
			return data
		}
		data, err := fetch(url)
		if err != nil {
			ferr = err
			return m
		}
		if err := cache.Put("remote:"+url, data); err != nil {
			ferr = err
		}
		return data
	})
	return out, ferr
}

func fetch(url string) ([]byte, error) {
	resp, err := http.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s: %s", url, resp.Status)
	}
	return io.ReadAll(resp.Body)
}
