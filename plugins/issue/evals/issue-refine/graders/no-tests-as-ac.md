---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?-{3}\n(?:(?!\n-{3}\n|</issue>)[\s\S])*?\n-{3}\n(?:^[ \t]*```[^\n]*\n(?:(?!^[ \t]*```)[\s\S])*?^[ \t]*```|(?!</issue>|^##[^\n]*Agent Context|^[ \t]*```)[\s\S])*?^#{2,6}[^\n]*Acceptance[^\n]*\n(?:(?!^#|</issue>)[\s\S])*?^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[.\][ \t]*)?(?:(?:add|write|extend)\w*[ \t]+)?(?:(?:a|new|unit|integration|regression|existing|the)[ \t]+)*(?:tests?|specs?|test coverage|ci)\b'
flags: mi
match: not_contains
---
No acceptance criterion is a test to write or a suite to pass. A criterion states what to check, and a test may carry it out.
