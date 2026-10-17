---
type: regex
pattern: '<issue>\s*(?:```\w*\n)?---\n(?=(?:(?!\n---\n)[\s\S])*?^title:[ \t]*\S)(?=(?:(?!\n---\n)[\s\S])*?^type:[ \t]*(?:bug|feature|refactor|spike)[ \t]*$)'
flags: m
match: contains
---
The reply holds the issue between `<issue>` tags, opening with frontmatter that sets `title` and a known `type`.
