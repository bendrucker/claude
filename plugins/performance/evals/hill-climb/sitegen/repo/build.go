package main

import (
	"bytes"
	"html/template"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

var page = template.Must(template.New("page").Parse(`<!doctype html>
<html><head><title>{{.Title}}</title></head>
<body><nav>{{range .Nav}}<a href="{{.}}">{{.}}</a>{{end}}</nav>
<main>{{.Body}}</main></body></html>`))

type pageData struct {
	Title string
	Nav   []string
	Body  template.HTML
}

func build(content, out string, cache *Cache) error {
	var pages []string
	err := filepath.WalkDir(content, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		switch {
		case d.IsDir():
			return nil
		case strings.HasSuffix(path, ".md"):
			pages = append(pages, path)
		case isImage(path):
			return writeImage(path, content, out, cache)
		}
		return nil
	})
	if err != nil {
		return err
	}
	nav := navLinks(pages, content)
	for _, p := range pages {
		if err := renderPage(p, content, out, nav, cache); err != nil {
			return err
		}
	}
	return nil
}

func renderPage(path, content, out string, nav []string, cache *Cache) error {
	src, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	src, err = expandIncludes(src, cache)
	if err != nil {
		return err
	}
	title, body := markdown(src)
	var buf bytes.Buffer
	if err := page.Execute(&buf, pageData{Title: title, Nav: nav, Body: body}); err != nil {
		return err
	}
	rel, _ := filepath.Rel(content, path)
	dst := filepath.Join(out, strings.TrimSuffix(rel, ".md")+".html")
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	return os.WriteFile(dst, minify(buf.Bytes()), 0o644)
}

func navLinks(pages []string, content string) []string {
	nav := make([]string, 0, len(pages))
	for _, p := range pages {
		rel, _ := filepath.Rel(content, p)
		nav = append(nav, "/"+strings.TrimSuffix(rel, ".md")+".html")
	}
	return nav
}

func markdown(src []byte) (string, template.HTML) {
	var title string
	var b strings.Builder
	for _, line := range strings.Split(string(src), "\n") {
		switch {
		case strings.HasPrefix(line, "# "):
			title = strings.TrimPrefix(line, "# ")
			b.WriteString("<h1>" + template.HTMLEscapeString(title) + "</h1>")
		case strings.HasPrefix(line, "## "):
			b.WriteString("<h2>" + template.HTMLEscapeString(line[3:]) + "</h2>")
		case strings.TrimSpace(line) == "":
		default:
			b.WriteString("<p>" + template.HTMLEscapeString(line) + "</p>")
		}
	}
	return title, template.HTML(b.String())
}

func minify(html []byte) []byte {
	var out bytes.Buffer
	space := false
	for _, c := range html {
		if c == ' ' || c == '\n' || c == '\t' {
			if !space {
				out.WriteByte(' ')
			}
			space = true
			continue
		}
		space = false
		out.WriteByte(c)
	}
	return out.Bytes()
}
