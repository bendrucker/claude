// Command ledgerroll rolls a day's gzipped transaction feed into a per-account CSV ledger.
package main

import (
	"bufio"
	"compress/gzip"
	"flag"
	"fmt"
	"io"
	"os"
)

func main() {
	in := flag.String("in", "", "gzipped JSON-lines transaction feed")
	flag.Parse()
	if err := run(*in, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(path string, w io.Writer) error {
	txns, err := readRecords(path)
	if err != nil {
		return err
	}
	groups := aggregate(txns)
	return render(w, groups)
}

func readRecords(path string) ([]Txn, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	zr, err := gzip.NewReader(f)
	if err != nil {
		return nil, err
	}
	defer zr.Close()

	var txns []Txn
	sc := bufio.NewScanner(zr)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		t, err := decodeRecord(sc.Bytes())
		if err != nil {
			return nil, fmt.Errorf("line %d: %w", len(txns)+1, err)
		}
		txns = append(txns, t)
	}
	return txns, sc.Err()
}
