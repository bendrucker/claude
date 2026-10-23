---
type: llm
focus: last_message
---
Read the reply's list of the suite's cases and their tags. Pass when at least 25% and at most 45% of the listed cases carry a `holdout` tag. 2 of 6, 3 of 8, and 4 of 10 pass, and so does a reply that groups the cases by tag and states the counts in a sentence. Fail when the share is below 25% or above 45%, such as 0 of 6, 1 of 10, or 3 of 5, or when no cases are listed.
