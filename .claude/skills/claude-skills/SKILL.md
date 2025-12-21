---
name: Claude Code Skills
description: Creating and optimizing Claude Code Skills including activation patterns, content structure, and development workflows. Use when creating new skills, converting memory files to skills, debugging skill activation, or understanding skill architecture and best practices.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, WebFetch(domain:docs.claude.com)]
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
allowed-tools: [Optional tool restrictions]
---
```

**Storage**: `~/.claude/skills/` (personal), `.claude/skills/` (project), plugins (bundled)

**Description**: Third-person, includes trigger terms and use cases. This is the primary activation mechanism.

## Bundled Resources

```
skill-name/
├── SKILL.md (required - overview, navigation)
├── references/ (documentation loaded as needed)
├── scripts/ (executable utilities)
└── assets/ (templates, images for output)
```

**Naming**: Reserve ALL CAPS for files with special meaning (SKILL.md, README.md, CONTRIBUTING.md). Use lowercase for all other files (setup.md, examples.md, troubleshooting.md).

Keep references one level deep. For files >100 lines, include a table of contents.

## Development Process

1. Define 3 test scenarios before documentation
2. Measure baseline without skill
3. Iterative: one instance creates, another tests
4. Observe navigation patterns
5. Refine based on behavior

## References

Load detailed guides as needed:

- **[references/patterns.md](references/patterns.md)** - Progressive disclosure patterns, output templates, workflow design
- **[references/troubleshooting.md](references/troubleshooting.md)** - Activation issues, YAML errors, path problems, checklist

## Quick Reference

**Common Patterns**: Read-only (`[Read, Grep, Glob]`), Script-based (`[Read, Bash, Write]`), Template-based (`[Read, Write, Edit]`)

**Anti-Patterns**: Windows paths, too many options, vague descriptions, nested references, scripts that punt errors

## Resources

- [Claude Code Skills](https://docs.claude.com/en/docs/claude-code/skills.md)
- [Agent Skills Best Practices](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices.md)
