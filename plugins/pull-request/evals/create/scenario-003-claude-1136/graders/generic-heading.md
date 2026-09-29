---
type: regex
pattern: '^#{2,6} (?:\*\*)?(?:Summary|Overview|Description|Motivation|Background|Context|Changes|Notes|Notes for Reviewers|Reviewer Notes|Test Plan|Testing|Why|How)(?:\*\*)?:?[ \t]*$'
flags: im
match: not_contains
---
Each Markdown heading names a topic in this change. A heading that would fit any pull request, such as a summary, a motivation, notes, or a test plan, fails.
