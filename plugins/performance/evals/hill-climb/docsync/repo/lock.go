package main

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
)

// Lock records the archive digest of every package last applied to the tree.
type Lock struct {
	Release  string            `json:"release"`
	Packages map[string]string `json:"packages"`
}

func readLock(path string) (Lock, error) {
	lock := Lock{Packages: map[string]string{}}
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return lock, nil
	}
	if err != nil {
		return lock, err
	}
	return lock, json.Unmarshal(data, &lock)
}

func (l Lock) changed(m Manifest) []Package {
	var out []Package
	for _, p := range m.Packages {
		if l.Packages[p.Name] != p.SHA256 {
			out = append(out, p)
		}
	}
	return out
}

func (l Lock) update(path string, m Manifest) error {
	l.Release = m.Release
	for _, p := range m.Packages {
		l.Packages[p.Name] = p.SHA256
	}
	data, err := json.MarshalIndent(l, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}
