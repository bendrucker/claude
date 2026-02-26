# Log Parsing

## CI Log Structure

CI logs are step-annotated: each step has a start marker and exit code. When a step exits non-zero, the relevant output is between that step's start marker and the exit. GitHub Actions prefixes each line with the step name, so filter to the failing step's lines to discard noise.

## Narrowing Large Output

Job logs can be tens of thousands of lines. If per-job output is still too large:
1. Try `--log-failed` to get only failing steps
2. Take the last 100-200 lines. Most tools print a summary section at the end, even with parallel/interleaved output.
