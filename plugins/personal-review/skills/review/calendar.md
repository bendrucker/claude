# Calendar Scan

Query today's events and calculate time budget for focused work.

## Time Budget

Calculate from a standard workday (9am-6pm, 9 hours):

- **Available hours**: Workday minus meeting time
- **Focus windows**: Gaps of 90+ minutes between meetings
- **Prep needs**: Meetings requiring preparation tasks

## Query

Load the `calendar:calendar` skill. Query today's events using the date range for today only.

## Analysis

For each event, note:
- Duration (end - start)
- Whether it's an all-day event (exclude from meeting time)
- Whether it requires preparation (complex topics, presentations)

Sum meeting durations to calculate:
- Total meeting hours
- Available hours = 9 - meeting hours
- List focus windows with start time and duration

## Output

Present:
- Today's events (time, title)
- Available hours for focused work
- Focus windows (start time and duration)
- Meetings needing prep → suggest creating Things tasks

## Re-Check (Post-Inbox)

After Things inbox processing, re-query today's events:

- Use the same query as the initial scan
- Compare with the initial results
- Note any new events (e.g., work calendar additions during personal triage)
- Update the time budget if new meetings were added

## Access Denied

When the calendar sub-agent reports `"reason": "no-app-bundle"`, EventKit cannot obtain TCC permissions. This happens in tmux, SSH, or any context where the responsible process lacks an app bundle. The review workflow skips calendar silently:

- Initial scan: note "Calendar: skipped (access denied)" and proceed
- Post-inbox re-check: skip entirely
- Summary: report calendar as skipped

Do not prompt the user to fix permissions — the environment does not support EventKit.

## Evening Variant

Preview tomorrow only:
- Query tomorrow's date range
- Summarize event count and total meeting time
- Flag early meetings (before 10am) or long days (6+ meeting hours)
