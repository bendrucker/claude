package main

import (
	"regexp"
	"strings"
)

type Record struct {
	Time   string `json:"time"`
	Host   string `json:"host"`
	Level  string `json:"level"`
	Region string `json:"region"`
	Msg    string `json:"msg"`
	Tag    string `json:"tag,omitempty"`
}

func processBatch(lines []string, stats *Stats) []Record {
	lines = dedupe(lines)
	records := make([]Record, 0, len(lines))
	for _, line := range lines {
		stats.Inc("events")
		rec, ok := parseLine(line)
		if !ok {
			stats.Inc("malformed")
			continue
		}
		rec.Host = normalizeHost(rec.Host)
		records = append(records, rec)
	}
	return records
}

// dedupe drops repeated events, keeping the first occurrence of each in order.
func dedupe(lines []string) []string {
	keys := make([]string, 0, len(lines))
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		key := eventKey(line)
		seen := false
		for _, k := range keys {
			if k == key {
				seen = true
				break
			}
		}
		if !seen {
			keys = append(keys, key)
			out = append(out, line)
		}
	}
	return out
}

// eventKey drops the receive timestamp, which differs between redelivered copies.
func eventKey(line string) string {
	if i := strings.IndexByte(line, ' '); i >= 0 {
		return line[i+1:]
	}
	return line
}

func parseLine(line string) (Record, bool) {
	re := regexp.MustCompile(`^(\S+) (\S+) \[(\w+)\] region=(\S+) (.*)$`)
	m := re.FindStringSubmatch(line)
	if m == nil {
		return Record{}, false
	}
	return Record{Time: m[1], Host: m[2], Level: m[3], Region: m[4], Msg: m[5]}, true
}

func normalizeHost(host string) string {
	re := regexp.MustCompile(`\.(internal|local|corp)\.example\.com$`)
	return strings.ToLower(re.ReplaceAllString(host, ""))
}
