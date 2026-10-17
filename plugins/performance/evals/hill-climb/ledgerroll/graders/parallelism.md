---
type: regex
pattern: '^\s*([-*+]|\d+[.)])\s[^\n]*(parallel|concurren|goroutine|GOMAXPROCS|errgroup|worker pool|pipelin)'
flags: im
match: contains
weight: 0.5
---
A list item weighs parallelism, climbed or set aside.
