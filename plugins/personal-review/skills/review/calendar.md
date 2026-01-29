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

## Evening Variant

Preview tomorrow only:
- Query tomorrow's date range
- Summarize event count and total meeting time
- Flag early meetings (before 10am) or long days (6+ meeting hours)
