---
type: llm
focus: last_message
---
`src/schedule/estimate.ts` parses durations, but in team units: business days (`bd`), sprints of 10 business days (`sp`), and focus hours (6 per business day), and `dueDate` skips weekends. No duration library parses these. Pass when the final reply keeps or rejects this parser with a reason about its domain-specific units or business-day arithmetic. Fail when the reply ranks it as a candidate to replace with a duration or date library, or never mentions it.
