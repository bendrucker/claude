---
type: llm
---
Judge only the PR body, the text after the `Title:` line. Ignore any commentary before that line. Pass when the body carries every point below, or all but one. A point counts in any wording and any form: a sentence, a list item, a table row, or a code block. Fail when two or more points are missing. Length, headings, and style do not matter here.

- The model emits fingerprinted findings while `ledger.ts` counts and decides what to promote
- Daily opens at most one draft PR, only for an entry seen today with high impact and a small fix
- Weekly ranks open entries by days seen then impact, showing the top 5, with near-misses listed
- Queries live in SQL files run by `collect.sh`, tested over synthetic data
- The calibration against labeled real symptoms, with only the cloudsmith auth failure promoting same-day
- Follow-ups: no 7d run yet, scheduling deferred, and process attribution waits on dotfiles#962
