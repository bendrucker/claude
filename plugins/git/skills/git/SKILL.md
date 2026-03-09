---
name: git
description: Git workflow and branching best practices. Use when working with git commands, creating branches, or pushing changes.
---

# Git

* **Never** `git push` to the default branch (usually `main` or `master`) unless I explicitly instruct you to do so.
* **Always** use a topic branch with a few brief word hyphenated name

## Commit Messages

For multi-line commit messages:

- **Simple (subject + body):** Use multiple `-m` flags. Each `-m` creates a separate paragraph:
  ```bash
  git commit -m "Subject line" -m "Body paragraph here."
  ```
- **Complex:** Use a heredoc or the Write tool:
  ```bash
  git commit -m "$(cat <<'EOF'
  Subject line

  Body paragraph here.
  EOF
  )"
  ```
  Or write to `tmp/commit-msg.md`, then `git commit -F tmp/commit-msg.md`.
