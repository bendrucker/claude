package main

import (
	"archive/tar"
	"compress/gzip"
	"encoding/json"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"text/template"
)

type Symbol struct {
	Name    string   `json:"name"`
	Kind    string   `json:"kind"`
	Doc     string   `json:"doc"`
	Related []string `json:"related"`
}

var page = template.Must(template.New("page").Parse(`# {{.Name}}

_{{.Kind}}_

{{.Doc}}
{{range .Related}}
- [{{.}}](@{{.}})
{{- end}}
`))

// apply renders every symbol in a package archive to a markdown page under dir.
func apply(dir string, p Package, archive string) (int, error) {
	f, err := os.Open(archive)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return 0, err
	}
	out := filepath.Join(dir, p.Name)
	if err := os.RemoveAll(out); err != nil {
		return 0, err
	}
	tr := tar.NewReader(gz)
	pages := 0
	for {
		h, err := tr.Next()
		if err == io.EOF {
			return pages, nil
		}
		if err != nil {
			return pages, err
		}
		if !strings.HasSuffix(h.Name, ".json") {
			continue
		}
		var s Symbol
		if err := json.NewDecoder(tr).Decode(&s); err != nil {
			return pages, err
		}
		path := filepath.Join(out, strings.TrimSuffix(h.Name, ".json")+".md")
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return pages, err
		}
		w, err := os.Create(path)
		if err != nil {
			return pages, err
		}
		if err := page.Execute(w, s); err != nil {
			w.Close()
			return pages, err
		}
		if err := w.Close(); err != nil {
			return pages, err
		}
		pages++
	}
}

var crossRef = regexp.MustCompile(`\]\(@([A-Za-z0-9_.]+)\)`)

// relink resolves every `@Symbol` link in the tree to the page that defines it.
func relink(dir string) error {
	where := map[string]string{}
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".md") {
			return err
		}
		rel, _ := filepath.Rel(dir, path)
		where[strings.TrimSuffix(filepath.Base(path), ".md")] = rel
		return nil
	})
	if err != nil {
		return err
	}
	return filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".md") {
			return err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		linked := crossRef.ReplaceAllStringFunc(string(data), func(m string) string {
			name := crossRef.FindStringSubmatch(m)[1]
			if target, ok := where[name]; ok {
				return "](/reference/" + strings.TrimSuffix(target, ".md") + ")"
			}
			return m
		})
		return os.WriteFile(path, []byte(linked), 0o644)
	})
}
