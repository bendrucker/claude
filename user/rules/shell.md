---
paths:
  - "**/*.sh"
  - "**/*.bash"
  - "**/*.zsh"
---

# Shell

- Use `--long-flags` where available for human readability
- Use macOS compatible commands, don't expect GNU tools
- In zsh, avoid `status` and `state` as variable names. They are read-only, so assignment fails with `read-only variable`. Use `st` or a descriptive name. Matters for loop/poll snippets that track a status value.
