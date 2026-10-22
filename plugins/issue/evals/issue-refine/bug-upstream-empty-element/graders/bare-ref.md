---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?-{3}\n(?:(?!\n-{3}\n|</issue>)[\s\S])*?\n-{3}\n(?:^[ \t]*```[^\n]*\n(?:(?!^[ \t]*```)[\s\S])*?^[ \t]*```|(?!</issue>|^##[^\n]*Agent Context|^[ \t]*```)[\s\S])*?(?:(?<![\w/\[`.#=-])(?!(?:ISO|UTF|SHA|RFC)-)(?:[A-Z]{2,}-\d+|MR[ \t]*!\d+)|(?<=\s)!\d+)\b(?![^\[\]\n]*\]\()'
flags: m
match: not_contains
weight: 3
---
On GitHub a same-repository `#75` expands natively, so only references the tracker can't resolve (`TEAM-412`, `!578`) count as bare.
