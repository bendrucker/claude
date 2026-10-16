---
type: regex
pattern: '^\s{0,3}[12][.)](?![^\n]*(?:image|resiz|screenshot|jpeg|fetch|remote|include|download|cache miss|cold|re-?profil|profile|parallel|concurren|worker|pipelin|goroutine|fan.?out))[^\n]*(?:template|Execute|escap|minif|markdown|WriteString|navLinks|\bnav\b|sha256|hash)'
flags: im
match: not_contains
---
Neither of the first two candidates is a CPU micro-optimization the profile over-ranks: template, minify, markdown, hashing.
