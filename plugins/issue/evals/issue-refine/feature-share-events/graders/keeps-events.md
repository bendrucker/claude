---
type: regex
pattern: '<issue>(?:(?!</issue>)[\s\S])*?(?=(?:(?!</issue>)[\s\S])*?link_copied)(?=(?:(?!</issue>)[\s\S])*?chat_opened)(?=(?:(?!</issue>)[\s\S])*?document_opened)'
match: contains
---
The issue names all three events: link_copied, chat_opened, and document_opened.
