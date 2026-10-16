// Command sitegen builds the docs site from content/ into public/.
package main

import (
	"flag"
	"fmt"
	"os"
	"runtime/pprof"
)

func main() {
	content := flag.String("content", "content", "content directory")
	out := flag.String("out", "public", "output directory")
	cacheDir := flag.String("cache", ".sitegen-cache", "build cache directory")
	cpuprofile := flag.String("cpuprofile", "", "write a CPU profile to this file")
	flag.Parse()
	if *cpuprofile != "" {
		f, err := os.Create(*cpuprofile)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		if err := pprof.StartCPUProfile(f); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		defer pprof.StopCPUProfile()
	}
	if err := build(*content, *out, NewCache(*cacheDir)); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
