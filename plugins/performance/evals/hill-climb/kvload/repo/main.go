// Command kvload imports a JSON-lines order export into an append-only store.
package main

import (
	"bufio"
	"flag"
	"fmt"
	"os"
)

func main() {
	in := flag.String("in", "", "order export, one JSON record per line")
	dir := flag.String("dir", "data", "store directory")
	flag.Parse()
	if err := run(*in, *dir); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(in, dir string) error {
	f, err := os.Open(in)
	if err != nil {
		return err
	}
	defer f.Close()
	st, err := Open(dir)
	if err != nil {
		return err
	}
	n, err := Import(st, bufio.NewReaderSize(f, 1<<20))
	if err != nil {
		return err
	}
	if err := st.Close(); err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "imported %d records\n", n)
	return nil
}
