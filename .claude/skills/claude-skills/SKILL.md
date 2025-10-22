---
name: claude-skills
description: Guide for creating, structuring, and troubleshooting Claude Code Skills. Use this skill whenever creating new skills, converting content to skills, or modifying existing skills to ensure proper structure and best practices.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, WebFetch(domain:docs.claude.com)]
---

# Claude Code Skills Development

This skill provides guidance and reference documentation for developing Claude Code Skills.

## Reference Documentation

Complete official documentation: [Claude Code Skills](https://docs.claude.com/en/docs/claude-code/skills.md)

## Quick Reference

### Skill Structure

```yaml
---
name: skill-name
description: What it does and when Claude should use it
allowed-tools: [Optional tool restrictions]
---

# Skill content in markdown
```

### Storage Locations

- **Personal Skills**: `~/.claude/skills/`
- **Project Skills**: `.claude/skills/` (shared via git)
- **Plugin Skills**: bundled with installed plugins

### Critical: The Description Field

The description determines when Claude activates the skill. Include:
- What the skill does
- Specific trigger phrases
- Use cases and context

## Workflow for Creating Skills

When helping users create new skills:

1. **Understand the purpose**
   - What capability does this skill provide?
   - When should it activate?
   - What are the trigger phrases?

2. **Draft the description**
   - Be specific and include triggers
   - Mention use cases explicitly
   - Example: "Generate PDF reports from markdown files. Use when creating PDFs, generating reports, or converting markdown to PDF format."

3. **Determine tool restrictions** (optional)
   - Does this skill need write access?
   - Should it be read-only? (`[Read, Grep, Glob]`)
   - Does it need shell access?

4. **Create the structure**
   - `mkdir -p ~/.claude/skills/skill-name` or `.claude/skills/skill-name`
   - Create `SKILL.md` with frontmatter
   - Add supporting files if needed (scripts, templates, docs)

5. **Write documentation**
   - Clear usage instructions
   - Prerequisites
   - Examples
   - Troubleshooting if applicable

6. **Test activation**
   - Use trigger phrases from description
   - Verify Claude activates it correctly
   - Test edge cases

## Common Patterns

### Read-Only Skills

For reference documentation or code analysis:

```yaml
allowed-tools: [Read, Grep, Glob]
```

### Script-Based Skills

For skills that execute scripts:

```yaml
allowed-tools: [Read, Bash, Write]
```

Then reference scripts in the skill content:
```bash
./scripts/deploy.sh
```

### Template-Based Skills

For generating files from templates:

```yaml
allowed-tools: [Read, Write, Edit]
```

Store templates in `templates/` directory.

## Troubleshooting

### Skill Not Activating

1. Check description specificity
2. Verify YAML syntax (no tabs, proper `---` delimiters)
3. Confirm file location
4. Test with explicit trigger phrases

### YAML Errors

- No tabs, only spaces
- Quote strings with special characters
- Proper `---` delimiters

### Path Issues

- Use forward slashes
- Verify paths exist
- Use `~` for home directory in personal skills

## Best Practices

1. **Keep skills focused** - One capability per skill
2. **Write discoverable descriptions** - Include specific triggers
3. **Test thoroughly** - Verify activation works
4. **Document well** - Clear usage instructions
5. **Version changes** - Track modifications over time
