# Comments

Detect AI slop code comments in a diff and steer clean comment generation.

LLMs over-produce low-value comments: restatement of simple code, narration of
the change, self-praise, and section-divider banners. This plugin audits any diff
for those, scoped to only the comments a change introduced, and judges them
against a two-type model of when a comment earns its place.

## Contents

- **`comments:audit`** skill: extract comments with tree-sitter, scope them to a
  diff's added lines, and judge the introduced comments with an LLM calibrated to
  the owner's comment model. Supports the working tree, a branch base, an explicit
  ref, and a GitLab merge request. Flag-only by default; `--fix` adds suggestions.
- **`detection/`**: deterministic tree-sitter comment extraction, unified-diff
  parsing and base resolution, diff-scoping, and high-precision advisory tells.
- **`judge/`**: the Anthropic judge harness and its versioned `prompt.md`.
- **`evals/`**: the labeled fixture corpus and the precision/recall eval with a
  must-pass-negative ship gate.
- A preventive steering rule lives at `user/rules/code-comments.md`, scoped by
  path to code files.

## Testing

Deterministic extraction, diff parsing, scoping, and tells:

```bash
bun test plugins/comments
```

The judge eval needs `ANTHROPIC_API_KEY`:

```bash
bun run plugins/comments/evals/eval.ts --gate
```

The ship gate is zero flags on the must-pass negatives (canonical-API docstrings,
genuine why-comments, regression-test rationale).
