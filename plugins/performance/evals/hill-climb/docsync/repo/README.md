# docsync

Keeps the docs site's API reference in step with the upstream SDK. Each upstream release publishes a manifest listing every package's symbol archive. `docsync` fetches the archives that changed, renders one markdown page per symbol under `site/reference/`, resolves the cross-package links, and rebuilds the search index.

## Usage

After each upstream release, a maintainer runs the sync from the repo root, waits for it to finish, and opens the docs PR with the result:

    go build -o bin/docsync . && bin/docsync sync

A release touches most of the 41 packages, so expect the sync to take about two minutes. Between releases it prints `up to date with <release>` and exits.

The `release-sync` workflow runs the same command on demand. Its logs from past releases are under `ci/logs/`.

## Layout

- `sync.go`: the resolve, fetch, apply, and index phases, each timed on stderr.
- `fetch.go`: downloads and verifies one archive.
- `apply.go`: renders pages and rewrites cross-package links.
- `index.go`: the search index.
- `bench/`: the benchmark harness.
