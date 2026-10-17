---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?-{3}\n(?=(?:(?!\n-{3}\n)[\s\S])*?^title:[ \t]*\S)(?=(?:(?!\n-{3}\n)[\s\S])*?^type:[ \t]*(?:bug|feature|refactor|spike)[ \t]*$)'
flags: m
match: contains
---
The reply holds the issue between `<issue>` tags, opening with frontmatter that sets `title` and a known `type`.
