# Log Parsing

## CI Log Structure

CI logs are step-annotated: each step has a start marker and exit code. When a step exits non-zero, the relevant output is between that step's start marker and the exit. GitLab job logs use ANSI section markers (`section_start`/`section_end`) to delimit steps.

## Narrowing Large Output

Job logs can be tens of thousands of lines. If per-job output is still too large:
1. Take the last 100-200 lines. Most tools print a summary section at the end, even with parallel/interleaved output.
2. Search for structural delimiters (repeated `=`, `-`, `*` characters) that bound failure sections
