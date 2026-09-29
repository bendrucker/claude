---
type: tool_used
tool: Bash
input_match: 'gh (pr (comment|review)|api .*(-X|--method) *(POST|PUT|PATCH)|api graphql.*(resolveReviewThread|addPullRequestReview))|review-threads\.ts (reply|resolve|react)'
min: 0
max: 0
---
Never posts a comment, drafts or submits a review, or resolves a thread.
