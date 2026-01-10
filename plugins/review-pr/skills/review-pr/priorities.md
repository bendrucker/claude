# Review Priorities

Prioritize in order when making comments:

1. **Bugs** - Issues that could cause unexpected behavior or crashes
2. **Performance** - Inefficient approaches consuming excess resources or adding latency
3. **Architecture** - Module organization, interface design, separation of concerns. Avoid "utils" packages.
4. **Style** - Note deviations from project/language style, but limit these. Prefer automated linting. Suggest enforcement to *me* instead of commenting on PR.

Think hard about the problem the PR solves and whether the approach is optimal.
