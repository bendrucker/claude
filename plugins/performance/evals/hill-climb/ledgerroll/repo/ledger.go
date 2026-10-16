package main

import (
	"bufio"
	"fmt"
	"io"
	"sort"
	"strconv"
)

type Group struct {
	Account  string
	Currency string
	Txns     []Txn
}

// aggregate groups transactions by account and currency, each group in time order.
func aggregate(txns []Txn) []*Group {
	index := map[string]*Group{}
	var groups []*Group
	for _, t := range txns {
		key := groupKey(t)
		g, ok := index[key]
		if !ok {
			g = &Group{Account: t.Account, Currency: t.Currency}
			index[key] = g
			groups = append(groups, g)
		}
		g.Txns = append(g.Txns, t)
		sort.Slice(g.Txns, func(i, j int) bool { return g.Txns[i].At.Before(g.Txns[j].At) })
	}
	sort.Slice(groups, func(i, j int) bool {
		if groups[i].Account != groups[j].Account {
			return groups[i].Account < groups[j].Account
		}
		return groups[i].Currency < groups[j].Currency
	})
	return groups
}

func groupKey(t Txn) string {
	return fmt.Sprintf("%s|%s", t.Account, t.Currency)
}

func render(w io.Writer, groups []*Group) error {
	bw := bufio.NewWriter(w)
	bw.WriteString("account,currency,at,amount,balance,memo\n")
	for _, g := range groups {
		balance := 0.0
		for _, t := range g.Txns {
			balance += t.Amount
			bw.WriteString(renderRow(g, t, balance))
		}
	}
	return bw.Flush()
}

func renderRow(g *Group, t Txn, balance float64) string {
	row := fmt.Sprintf("%s,%s,%s,", g.Account, g.Currency, t.At.Format("2006-01-02T15:04:05.000Z"))
	row += fmt.Sprintf("%.2f,", t.Amount)
	row += formatAmount(balance) + ","
	row += strconv.Quote(t.Memo) + "\n"
	return row
}

func formatAmount(v float64) string {
	return strconv.FormatFloat(v, 'f', 2, 64)
}
