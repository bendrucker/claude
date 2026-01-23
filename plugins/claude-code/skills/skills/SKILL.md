---
name: skills
description: Creating and optimizing Claude Code Skills including activation patterns, content structure, and development workflows. Use when creating new skills, converting memory files to skills, debugging skill activation, or understanding skill architecture and best practices.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, WebFetch(domain:docs.claude.com)]
hooks:
  PostToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: "npx tsx ${CLAUDE_SKILL_ROOT}/scripts/check-namespace.ts"
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
name: skill-name
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
- `name`: Lowercase letters, numbers, hyphens only (max 64 chars). Match directory name.
- `description`: Third-person, includes trigger terms and use cases (max 1024 chars).

**Optional Fields**:
- `allowed-tools`: Tools Claude can use without permission when skill is active
- `model`: Override the conversation's model
- `context`: Set to `fork` to run in isolated subagent context
- `agent`: Agent type when `context: fork` (`Explore`, `Plan`, `general-purpose`, or custom)
- `user-invocable`: Hide from slash menu when `false` (default: `true`)
- `disable-model-invocation`: Block programmatic invocation via Skill tool
- `hooks`: Skill-scoped hooks (`PreToolUse`, `PostToolUse`, `Stop`)

**Naming**: Use gerund form (verb + -ing): `processing-pdfs`, `analyzing-data`, `managing-databases`. Avoid vague names like `helper`, `utils`.

**Storage**: `~/.claude/skills/` (personal), `.claude/skills/` (project), plugins (bundled)

## Bundled Resources

```
skill-name/
├── SKILL.md (required - overview, navigation)
├── references/ (documentation loaded as needed)
├── scripts/ (executable utilities)
└── assets/ (templates, images for output)
```

**File Naming**: Reserve ALL CAPS for files with special meaning (SKILL.md, README.md). Use lowercase for all other files (setup.md, examples.md).

Keep references one level deep. For files >100 lines, include a table of contents.

## Development Process

- Define 3 test scenarios before documentation
- Measure baseline without skill
- Iterative: one instance creates, another tests
- Observe navigation patterns
- Refine based on behavior

## References

Load detailed guides as needed:

- **[references/patterns.md](references/patterns.md)** - Progressive disclosure, templates, workflows, subagent integration
- **[references/troubleshooting.md](references/troubleshooting.md)** - Activation issues, YAML errors, plugin cache, checklist

## Quick Reference

**Common Patterns**: Read-only (`[Read, Grep, Glob]`), Script-based (`[Read, Bash, Write]`), Template-based (`[Read, Write, Edit]`)

**Anti-Patterns**: Windows paths, too many options, vague descriptions, nested references, scripts that punt errors

## Resources

- [Claude Code Skills](https://docs.claude.com/en/docs/claude-code/skills)
- [Agent Skills Best Practices](https://docs.anthropic.com/en/docs/agents-and-tools/agent-skills/best-practices)
