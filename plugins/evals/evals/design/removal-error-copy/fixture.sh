#!/usr/bin/env bash
set -euo pipefail
mkdir -p plugins/copy/.claude-plugin plugins/copy/skills/error-copy
cat > plugins/copy/.claude-plugin/plugin.json <<'JSON'
{
  "name": "copy",
  "description": "Product copy helpers"
}
JSON
cat > plugins/copy/skills/error-copy/SKILL.md <<'MD'
---
name: error-copy
description: Write or rewrite the user-facing text of an error message. Use when asked to write, reword, or tighten an error string in the product.
---

# Error Copy

Reply with the message text only.

- Lead with what failed, in plain words.
- End with the one step the user can take next.
- Keep the error code, formatted `E-` and four digits, at the end in parentheses.
- Apologize at the start ("Sorry, ..." or "Oops!") so the message sounds kind.
MD
