---
name: claude-code:skill
description: Creating and optimizing Claude Code Skills including activation patterns, content structure, and development workflows. Use when creating new skills, converting memory files to skills, debugging skill activation, or understanding skill architecture and best practices.
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - WebFetch(domain:docs.claude.com)
hooks:
  PostToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/skills/skill/scripts/check-namespace.ts"
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/skills/skill/scripts/check-structure.ts"
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/skills/skill/scripts/check-lint.ts"
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

## Skill Authoring Best Practices

#### Description Is a Trigger

The description field is not a summary. It's what Claude scans to decide whether to activate the skill. Write it for the model: trigger terms, use cases, and "Use when..." phrasing. Make it slightly pushy to combat under-triggering.

#### Skip the Obvious

The context window is a public good. Don't restate what Claude already knows about coding or the codebase. Focus on information that pushes Claude out of its defaults — gotchas, internal conventions, non-obvious constraints.

#### Build a Gotchas Section

The highest-signal content in any skill is a `## Gotchas` section documenting failure modes Claude hits in practice. Start small and grow it over time as new edge cases surface. Every skill that wraps a library, API, or workflow should have one.

#### Progressive Disclosure

A skill is a folder, not just a markdown file. Keep `SKILL.md` concise (~30 lines for the hub) and push details into `references/`, `scripts/`, and `assets/`. Tell Claude what files exist and when to read them; it loads them at the right times.

#### Don't Railroad Claude

Give Claude the information it needs but leave room to adapt. Prefer outcome-oriented instructions ("Cherry-pick the commit onto a clean branch. Resolve conflicts preserving intent.") over step-by-step scripts ("Step 1: Run git log. Step 2: Run git cherry-pick...").

#### First-Run Setup

Skills that depend on user-specific context should check for a `config.json` in `${CLAUDE_SKILL_DIR}` or `${CLAUDE_PLUGIN_DATA}`. If missing, prompt the user for setup (e.g., which Slack channel, which project). Store answers for future runs.

#### Store Persistent Data in `${CLAUDE_PLUGIN_DATA}`

Skills can maintain state across runs: append-only logs, JSON records, SQLite databases. Use `${CLAUDE_PLUGIN_DATA}` for storage that survives plugin upgrades. Example: a standup skill keeps a `standups.log` so Claude can diff against yesterday.

#### Give Claude Code to Compose

Include helper scripts and libraries that Claude can import and compose on the fly. This lets Claude spend turns on decisions, not reconstructing boilerplate. Document scripts with `"Run script.py"` (execute) vs `"See script.py"` (reference).

#### On-Demand Hooks

Skill-scoped hooks activate only when the skill is invoked and last for the session. Use these for opinionated guardrails that would be annoying globally but valuable in specific contexts (e.g., blocking destructive commands during prod operations).

## Content Features

### String Substitutions

| Variable               | Description                                                                      |
| :---------------------- | :------------------------------------------------------------------------------- |
| `$ARGUMENTS`           | All arguments passed when invoking the skill. Appended automatically if absent.  |
| `$ARGUMENTS[N]` / `$N` | Access a specific argument by 0-based index.                                     |
| `${CLAUDE_SESSION_ID}` | Current session ID.                                                              |
| `${CLAUDE_SKILL_DIR}` | Absolute path to the skill's directory. Substituted in skill content: the body, `!` injection commands, and `allowed-tools`. |

These substitutions apply to skill content, not the frontmatter `hooks:` block. The hooks engine expands only `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}`, and `${CLAUDE_PLUGIN_DATA}` ([hooks reference](https://code.claude.com/docs/en/hooks)); `${CLAUDE_SKILL_DIR}` there resolves to an empty string. In a hook command, reference a bundled script by plugin root instead: `${CLAUDE_PLUGIN_ROOT}/skills/<skill>/scripts/check.ts`.

### Dynamic Context Injection

The bang-backtick syntax runs shell commands **before** the skill content is sent to Claude. The output replaces the placeholder — Claude sees only the result, not the command. This is preprocessing, not something Claude executes. Use it to inject live data (git state, CLI output, file contents) so the harness extracts and runs the commands without waiting on the model.

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

Use the `skill-creator` skill for interactive skill creation workflows — it drives the full lifecycle of drafting, testing with parallel subagents, benchmarking, and iterating. This skill provides the plugin-specific constraints (namespacing, structure, validation) that skill-creator applies during creation.

## Validation

A skill-scoped PostToolUse hook runs `skill-lint` automatically when SKILL.md files are edited. For manual checks, run `bun run skill-lint path/to/skill/` from the project root.

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
