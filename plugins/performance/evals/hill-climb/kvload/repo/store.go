package main

import (
	"encoding/binary"
	"encoding/json"
	"hash/crc32"
	"os"
	"path/filepath"
)

// Store appends length-prefixed, checksummed records to a write-ahead log and
// keeps an in-memory index from key to log offset.
type Store struct {
	wal   *os.File
	index map[string]int64
	off   int64
}

func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	wal, err := os.OpenFile(filepath.Join(dir, "orders.wal"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return nil, err
	}
	info, err := wal.Stat()
	if err != nil {
		return nil, err
	}
	return &Store{wal: wal, index: map[string]int64{}, off: info.Size()}, nil
}

// Put appends one record and syncs the log, so the record survives a crash.
func (s *Store) Put(r Record) error {
	body, err := json.Marshal(r)
	if err != nil {
		return err
	}
	frame := make([]byte, 8+len(body))
	binary.LittleEndian.PutUint32(frame[0:4], uint32(len(body)))
	binary.LittleEndian.PutUint32(frame[4:8], crc32.ChecksumIEEE(body))
	copy(frame[8:], body)
	if _, err := s.wal.Write(frame); err != nil {
		return err
	}
	if err := s.wal.Sync(); err != nil {
		return err
	}
	s.index[r.Key] = s.off
	s.off += int64(len(frame))
	return nil
}

func (s *Store) Close() error {
	if err := writeIndex(s.wal.Name()+".idx", s.index); err != nil {
		return err
	}
	return s.wal.Close()
}

func writeIndex(path string, index map[string]int64) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	if err := json.NewEncoder(f).Encode(index); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}
