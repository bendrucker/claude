---
type: llm
---
Read only the issue between the <issue> lines, above any "Agent Context" heading. The event definitions (each event, when it fires, and its properties) appear in structured form: a table, a schema or code block, or a list with one item per event or per property. Several properties may share one table cell or list item. Explaining the same definitions in prose paragraphs, one paragraph per event, fails. For example, a table with Event, Fires When, and Properties columns passes, and so does a nested list like "- `chat_opened`: chat card link click. Properties: `id`, `access`, `list`".
