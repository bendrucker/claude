package main

import (
	"encoding/json"
	"fmt"
	"strconv"
	"time"
)

type Txn struct {
	Account  string
	Currency string
	At       time.Time
	Amount   float64
	Memo     string
}

func decodeRecord(line []byte) (Txn, error) {
	var raw map[string]any
	if err := json.Unmarshal(line, &raw); err != nil {
		return Txn{}, err
	}
	at, err := parseTime(raw["at"])
	if err != nil {
		return Txn{}, err
	}
	return toRecord(raw, at)
}

func parseTime(v any) (time.Time, error) {
	s, ok := v.(string)
	if !ok {
		return time.Time{}, fmt.Errorf("at: want string, got %T", v)
	}
	return time.Parse(time.RFC3339Nano, s)
}

func toRecord(raw map[string]any, at time.Time) (Txn, error) {
	t := Txn{At: at}
	t.Account, _ = raw["account"].(string)
	t.Currency, _ = raw["currency"].(string)
	t.Memo, _ = raw["memo"].(string)
	switch a := raw["amount"].(type) {
	case float64:
		t.Amount = a
	case string:
		f, err := strconv.ParseFloat(a, 64)
		if err != nil {
			return Txn{}, err
		}
		t.Amount = f
	default:
		return Txn{}, fmt.Errorf("amount: want number, got %T", a)
	}
	return t, nil
}
