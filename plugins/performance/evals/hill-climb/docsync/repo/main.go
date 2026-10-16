package main

import (
	"flag"
	"fmt"
	"os"
)

func main() {
	if len(os.Args) < 2 || os.Args[1] != "sync" {
		fmt.Fprintln(os.Stderr, "usage: docsync sync [--manifest URL|PATH] [--dir DIR]")
		os.Exit(2)
	}
	fs := flag.NewFlagSet("sync", flag.ExitOnError)
	manifest := fs.String("manifest", defaultManifest, "upstream release manifest, a URL or a path")
	dir := fs.String("dir", "site/reference", "reference tree to update")
	_ = fs.Parse(os.Args[2:])
	if err := run(*manifest, *dir); err != nil {
		fmt.Fprintln(os.Stderr, "docsync:", err)
		os.Exit(1)
	}
}
