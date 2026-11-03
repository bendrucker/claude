#!/usr/bin/env bash
set -euo pipefail
tree=$(mktemp -d "${TMPDIR:-/tmp}/check.XXXXXX")
cleanup() { rm -rf "$tree"; }
trap cleanup EXIT
git archive HEAD | tar -x -C "$tree"
export GOCACHE="$tree/.gocache" GOPATH="$tree/.gopath"
cp -R "$1"/. "$tree"/
cd "$tree/tools/ledgerroll"
[ -z "$(gofmt -l .)" ]
GOTOOLCHAIN=local GOFLAGS=-mod=mod go vet ./...
GOTOOLCHAIN=local GOFLAGS=-mod=mod go test ./...
