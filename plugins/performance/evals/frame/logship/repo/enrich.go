package main

import (
	"crypto/sha256"
	"encoding/hex"
)

var regions = []string{"us-east", "us-west", "eu-central", "ap-south"}

// fanOut resolves each region's routing tag and stamps it on that region's records.
func fanOut(records []Record) []Record {
	tags := make(map[string]string, len(regions))
	// TODO: resolve regions concurrently.
	for _, region := range regions {
		tags[region] = resolveRegion(region, records)
	}
	for i := range records {
		records[i].Tag = tags[records[i].Region]
	}
	return records
}

// resolveRegion derives a region's routing tag from a digest of its messages.
func resolveRegion(region string, records []Record) string {
	h := sha256.New()
	for _, rec := range records {
		if rec.Region == region {
			h.Write([]byte(rec.Msg))
		}
	}
	return hex.EncodeToString(h.Sum(nil))[:12]
}
