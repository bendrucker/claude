// Command logship replays an incident event log into routed JSON records.
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"time"
)

func main() {
	in := flag.String("in", "-", "event log, one event per line")
	flag.Parse()
	if err := run(*in, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(path string, w io.Writer) error {
	lines, err := readEvents(path)
	if err != nil {
		return err
	}
	stats := NewStats()
	stop := stats.ReportEvery(time.Second, os.Stderr)
	defer stop()

	records := processBatch(lines, stats)
	records = fanOut(records)
	return writeOutput(w, records)
}

func readEvents(path string) ([]string, error) {
	r := os.Stdin
	if path != "-" {
		f, err := os.Open(path)
		if err != nil {
			return nil, err
		}
		defer f.Close()
		r = f
	}
	var lines []string
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		lines = append(lines, sc.Text())
	}
	return lines, sc.Err()
}

func writeOutput(w io.Writer, records []Record) error {
	bw := bufio.NewWriter(w)
	for _, rec := range records {
		b, err := json.Marshal(rec)
		if err != nil {
			return err
		}
		bw.Write(b)
		bw.WriteByte('\n')
	}
	return bw.Flush()
}
