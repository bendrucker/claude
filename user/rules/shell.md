---
paths:
  - "**/*.sh"
  - "**/*.bash"
  - "**/*.zsh"
---

# Shell

- Use `--long-flags` where the command offers them.
- Write for the BSD userland macOS ships, not GNU. For example, `sed -i ''` takes a suffix argument, and `date`, `stat`, and `readlink` lack the GNU flags.
- In zsh, name a variable `st` or something descriptive instead of `status` or `state`. Both are read-only, so assigning one fails with `read-only variable`.
