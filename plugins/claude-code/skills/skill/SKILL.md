---
name: claude-code:skill
description: Creating and optimizing Claude Code Skills including activation patterns, content structure, and development workflows. Use when creating new skills, converting memory files to skills, debugging skill activation, or understanding skill architecture and best practices.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, WebFetch(domain:docs.claude.com)]
hooks:
  PostToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: "bun ${CLAUDE_SKILL_ROOT}/scripts/check-namespace.ts"
        - type: command
          command: "bun ${CLAUDE_SKILL_ROOT}/scripts/check-structure.ts"
---

# Claude Code Skills Development

Reference for developing effective skills. The context window is a public good - only include information Claude doesn't already possess.

## Core Principles

- **Conciseness**: Keep `SKILL.md` under 500 lines. Use progressive disclosure.
- **Appropriate Freedom**: Text for flexible tasks, pseudocode for moderate variation, scripts for error-prone operations.
- **Cross-Model Testing**: Validate across Haiku, Sonnet, and Opus.

## Skill Structure

```yaml
---
name: plugin-name:skill-name
description: Third-person capability description with trigger terms
allowed-tools: [Read, Grep, Glob]         # Optional: tool restrictions
model: claude-sonnet-4-20250514           # Optional: override model
context: fork                             # Optional: run in isolated subagent
agent: Explore                            # Optional: agent type for fork
user-invocable: false                     # Optional: hide from slash menu
hooks:                                    # Optional: skill-scoped hooks
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate.sh"
          once: true
---
```

**Required Fields**:
- `name`: Lowercase letters, numbers, hyphens only (max 64 chars). Plugin skills use `plugin-name:skill-name` prefix for disambiguation. Skip the prefix when name equals plugin name.
- `description`: Third-person, includes trigger terms and use cases (max 1024 chars).

**Optional Fields**:
- `allowed-tools`: Tools Claude can use without permission when skill is active
- `model`: Override the conversation's model
- `context`: Set to `fork` to run in isolated subagent context
- `agent`: Agent type when `context: fork` (`Explore`, `Plan`, `general-purpose`, or custom)
- `user-invocable`: Hide from slash menu when `false` (default: `true`)
- `disable-model-invocation`: Block programmatic invocation via Skill tool
- `hooks`: Skill-scoped hooks (`PreToolUse`, `PostToolUse`, `Stop`)

**Naming**: Plugin skills use `plugin-name:skill-name` with a colon namespace (e.g., `gitlab:ci`, `things:inbox`). The part after the colon should not repeat the plugin name. For standalone skills, use gerund form (verb + -ing): `processing-pdfs`, `analyzing-data`. Avoid vague names like `helper`, `utils`.

**Storage**: `~/.claude/skills/` (personal), `.claude/skills/` (project), plugins (bundled)

## Content Features

### String Substitutions

| Variable               | Description                                                                      |
| :---------------------- | :------------------------------------------------------------------------------- |
| `$ARGUMENTS`           | All arguments passed when invoking the skill. Appended automatically if absent.  |
| `$ARGUMENTS[N]` / `$N` | Access a specific argument by 0-based index.                                     |
| `${CLAUDE_SESSION_ID}` | Current session ID.                                                              |
| `${CLAUDE_SKILL_ROOT}` | Absolute path to the skill's directory. Works in hooks and allowed-tools, but NOT in `!` context. |

### Dynamic Context Injection

The bang-backtick syntax runs shell commands **before** the skill content is sent to Claude. The command output replaces the placeholder — Claude only sees the final result, not the command. This is preprocessing, not something Claude executes. Use this to inject live data (git state, CLI output, file contents) so the application harness extracts and runs the commands without waiting on the model.

See [references/patterns.md](references/patterns.md) for syntax, examples, and gotchas.

## Directory Structure

Skills follow the [Agent Skills](https://agentskills.io/specification#optional-directories) directory convention. Only `SKILL.md` is required; all directories are optional.

```
skill-name/
├── SKILL.md        # Required: instructions and frontmatter
├── scripts/        # Executable code agents can run
├── references/     # Documentation loaded on demand
└── assets/         # Static resources (templates, images, data files)
```

A PostToolUse hook validates writes to skill directories against this structure.

### `scripts/`

Executable code that agents run. Scripts should be self-contained, document dependencies, and include error messages.

### `references/`

Additional documentation loaded when needed. Keep files focused — smaller files mean less context usage. Use descriptive names matching the domain (`finance.md`, `api.md`).

### `assets/`

Static resources: templates, images, diagrams, lookup tables, schemas.

### File Naming

Reserve ALL CAPS for files with special meaning (`SKILL.md`, `README.md`). Use lowercase for all other files. Keep references one level deep. For files >100 lines, include a table of contents.

## Development Process

- Define 3 test scenarios before documentation
- Measure baseline without skill
- Iterative: one instance creates, another tests
- Observe navigation patterns
- Refine based on behavior

## Validation

Run `bunx skill-lint path/to/skill/` to check for issues before committing. CI runs this automatically.

## References

Load detailed guides as needed:

- **[references/patterns.md](references/patterns.md)** - Dynamic context injection, argument substitutions, progressive disclosure, workflows, subagent integration
- **[references/troubleshooting.md](references/troubleshooting.md)** - Activation issues, YAML errors, plugin cache, checklist

## Quick Reference

**Common Patterns**: Read-only (`[Read, Grep, Glob]`), Script-based (`[Read, Bash, Write]`), Template-based (`[Read, Write, Edit]`)

**Content Features**: `$ARGUMENTS` / `$N` for arguments, bang-backtick for dynamic context injection

**Anti-Patterns**: Windows paths, too many options, vague descriptions, nested references, scripts that punt errors

## Resources

- [Agent Skills Specification](https://agentskills.io/specification)
- [Claude Code Skills](https://code.claude.com/docs/en/skills)
- [Agent Skills Best Practices](https://docs.anthropic.com/en/docs/agents-and-tools/agent-skills/best-practices)
