# Skill Patterns

## Progressive Disclosure

### Pattern 1: High-level guide with references

```markdown
# PDF Processing

## Quick start
[code example]

## Advanced features
- **Form filling**: See [references/forms.md](references/forms.md)
- **API reference**: See [references/api.md](references/api.md)
```

### Pattern 2: Domain-specific organization

For skills with multiple domains or frameworks:

```
bigquery-skill/
├── SKILL.md (overview and navigation)
└── references/
    ├── finance.md (revenue, billing)
    ├── sales.md (pipeline, opportunities)
    └── product.md (API usage)
```

When user asks about sales, Claude only reads `sales.md`.

### Pattern 3: Conditional details

```markdown
## Creating documents
Use docx-js. See [references/docx-js.md](references/docx-js.md).

## Editing documents
For simple edits, modify XML directly.
**For tracked changes**: See [references/redlining.md](references/redlining.md)
```

## Output Patterns

### Template Pattern

**Strict requirements:**
```markdown
ALWAYS use this exact structure:
# [Title]
## Executive summary
[One paragraph]
## Key findings
- Finding with data
```

**Flexible guidance:**
```markdown
Sensible default format, adapt as needed:
# [Title]
## Summary
[Adapt based on findings]
```

### Examples Pattern

Provide input/output pairs:

```markdown
**Example 1:**
Input: Added user authentication with JWT
Output: feat(auth): implement JWT-based authentication
```

## Workflow Patterns

### Sequential

```markdown
1. Analyze form (run analyze_form.py)
2. Create mapping (edit fields.json)
3. Validate (run validate_fields.py)
4. Fill form (run fill_form.py)
```

### Conditional

```markdown
1. Determine type:
   **Creating?** → Follow creation workflow
   **Editing?** → Follow editing workflow
```

## Skills and Subagents

### Give a subagent access to skills

Custom agents in `.claude/agents/` can list skills in their `skills` field:

```yaml
# .claude/agents/code-reviewer.md
---
name: code-reviewer
description: Review code for quality and best practices
skills: pr-review, security-check
---
```

Skills listed here are injected into the subagent's context at startup. Built-in agents (Explore, Plan, general-purpose) do not inherit skills.

### Run a skill in a subagent context

Use `context: fork` to run a skill in an isolated subagent:

```yaml
---
name: code-analysis
description: Analyze code quality and generate detailed reports
context: fork
agent: Explore
---
```

The skill runs with its own conversation history, avoiding clutter in the main conversation.

## Skill-Scoped Hooks

Define hooks that run during the skill's lifecycle:

```yaml
---
name: secure-operations
description: Perform operations with additional security checks
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/security-check.sh"
          once: true
---
```

**`once: true`**: Run the hook only once per session. After first successful execution, the hook is removed. Useful for one-time validation or setup.

Skill hooks are scoped to the skill's execution and cleaned up when the skill finishes.

### Prefer Specific Matchers

Use tool argument patterns instead of generic tool names with internal filtering. Combine multiple patterns with `|`:

```yaml
# Preferred: specific matchers, combined with pipe, readable multi-line YAML
hooks:
  PreToolUse:
    - matcher: "Bash(osascript:*)|Bash(open:*)"
      hooks:
        - type: command
          command: |
            jq -n '{
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                updatedInput: { dangerouslyDisableSandbox: true }
              }
            }'
```

```yaml
# Avoid: generic matcher with internal filtering
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/maybe-disable-sandbox.sh"
```

**Best practices:**
- Use specific matchers (`Bash(osascript:*)`) over generic ones (`Bash`)
- Combine related matchers with `|` instead of duplicating hook entries
- Use YAML multi-line syntax (`|`) for readable commands
- Use `jq -n` for static JSON responses instead of escaped echo strings

## Content Guidelines

- **Consistent Terminology**: One term per concept
- **Examples Over Description**: Input/output pairs show desired style
- **Imperative Form**: Use "Run script" not "You should run"
- **Avoid Time-Sensitive Info**: Use "Old Patterns" sections for deprecated methods

## Executable Code

- Handle errors explicitly (don't punt to Claude)
- Document constants with justification
- Clarify intent: "Run script.py" (execute) vs "See script.py" (reference)
- Use fully qualified MCP names: `ServerName:tool_name`
- List package dependencies
