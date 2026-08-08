# Stacking

A branch whose parent is another topic branch rather than the default branch is a stack layer, and its PR has to target that parent. `--base <ref>` names the parent, and so does the user saying what this branch sits on. Nothing else does: the branch's own upstream ref points at its remote copy, not its parent. Without either signal, open against the default branch.

On GitHub, create the PR with `--base <parent>`, then chain it into the stack with `gh stack link`. Creating it first is what preserves the drafted title and body: `link` reuses the open PR it finds, and auto-generates both for PRs it opens itself. The native alternative, `gh stack submit`, prompts for them in a full-screen editor no tool call can drive.

Which form of `link` to use depends on whether the parent is already stacked. `gh stack view --short` answers when the stack is tracked in this working tree, and `github:stack`'s detection query answers against the parent's PR either way.

```
gh stack link <stack-number> <this-branch> # parent is in a stack: append to it
gh stack link <bottom> ... <this-branch>   # parent isn't: list the chain bottom to top
```

`link` writes no local tracking state. It works whether or not `gh stack` owns the branches here. On a tracked stack the next `gh stack sync` reconciles the new PR into local state.

Exit code 9 means the repo doesn't have stacked PRs enabled. Leave the PR as it is: `--base <parent>` already targets the right branch, and with no stack object the merge takes the ordinary `gh pr merge` path. Say so and move on.

Load `github:stack` for the two layouts, the queries, and the merge behavior. For advanced GitLab features (stacking, username lookup), load `gitlab:merge-request`.
