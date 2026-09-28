---
type: regex
pattern: '<out>(?:(?!</out>)[\s\S])*?(optional[\s\S]{0,150}(exclud|skip|omit|ignor)|(exclud|skip|omit|ignor)[\s\S]{0,150}optional)'
flags: i
match: contains
---
A missing package marked `optional` is skipped rather than erroring.
