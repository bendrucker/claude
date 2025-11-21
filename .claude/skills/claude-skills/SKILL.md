---
name: Claude Code Skills
description: Creating and optimizing Claude Code Skills including activation patterns, content structure, and development workflows. Use when creating new skills, converting memory files to skills, debugging skill activation, or understanding skill architecture and best practices.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, WebFetch(domain:docs.claude.com)]
---

# Claude Code Skills Development

Reference documentation for developing effective Claude Code Skills. The context window is a public good - only include information Claude doesn't already possess.

## Core Principles

**Conciseness**: Keep `SKILL.md` under 500 lines. Use progressive disclosure - split detailed content into separate files loaded on-demand.

**Appropriate Freedom**: Match specificity to task fragility:
- Text instructions for flexible tasks
- Pseudocode for moderate variation
- Specific scripts for error-prone operations

**Cross-Model Testing**: Validate skills across Haiku, Sonnet, and Opus for effectiveness.

## Skill Structure

```yaml
---
name: skill-name
description: Third-person capability description with trigger terms
allowed-tools: [Optional tool restrictions]
---

# Overview and navigation (SKILL.md stays minimal)
```

### Storage Locations

- **Personal**: `~/.claude/skills/`
- **Project**: `.claude/skills/` (shared via git)
- **Plugin**: Bundled with installed plugins

### Description Best Practices

Write in third person to avoid system prompt conflicts:

✓ "Analyzing spreadsheets and generating reports from Excel files. Use when working with XLSX files, data analysis, or report generation."

✗ "I can help you analyze spreadsheets..."

Include:
- What the skill does
- Specific trigger terms
- Key use cases

## Information Architecture

**Progressive Disclosure Pattern**:
```
skill-name/
├── SKILL.md (overview, navigation only)
├── REFERENCE.md (detailed info, loaded as needed)
├── EXAMPLES.md (usage examples)
└── scripts/ (executable utilities)
```

**File References**: Keep one level deep from `SKILL.md`. Avoid nested references that cause partial reads.

## Content Guidelines

**Consistent Terminology**: Choose one term per concept. Always "API endpoint," not mixing with "URL" or "path."

**Examples Over Description**: Provide input/output pairs showing desired style and detail level.

**Workflows with Checklists**: For complex tasks, provide copyable checklists Claude can track:
```
Step 1: Analyze form (run analyze_form.py)
Step 2: Create mapping structure
Step 3: Apply transformations
```

**Avoid Time-Sensitive Info**: Use "Old Patterns" sections for deprecated methods rather than time-based conditionals.

## Development Workflow

1. **Create Representative Tests**: Define three test scenarios before extensive documentation

2. **Measure Baseline**: Test performance without skill to identify improvement areas

3. **Iterative Development**: Use one Claude instance to create/refine skill content while testing with another on real tasks

4. **Observe Navigation**: Monitor how Claude uses the skill - unexpected file access indicates structure issues

5. **Refine Based on Behavior**: Adjust based on observed gaps and patterns

## Executable Code Best Practices

**Error Handling**: Handle conditions explicitly rather than failing and requiring intervention.

**Justified Constants**: Document why parameters exist:
```python
# Three retries balances reliability vs speed
# Most failures resolve by second retry
MAX_RETRIES = 3
```

**Deterministic vs Reference**: Clarify intent:
- "Run analyze_form.py" (execute)
- "See analyze_form.py" (read as reference)

**MCP Tool Names**: Use fully qualified format: `ServerName:tool_name`

**Package Dependencies**: List required packages and verify availability.

## Common Patterns

### Read-Only Reference Skills

```yaml
allowed-tools: [Read, Grep, Glob]
```

For documentation and code analysis.

### Script-Based Skills

```yaml
allowed-tools: [Read, Bash, Write]
```

Reference scripts with forward slashes: `scripts/helper.py`

### Template-Based Skills

```yaml
allowed-tools: [Read, Write, Edit]
```

Store templates in `templates/` directory.

## Anti-Patterns to Avoid

- Windows-style paths (use forward slashes everywhere)
- Too many options (provide one default with escape hatches)
- Vague descriptions ("Helps with documents")
- Deeply nested references
- Scripts that punt errors to Claude
- Time-based conditionals

## Troubleshooting

### Skill Not Activating

1. Verify description includes specific trigger terms
2. Check YAML syntax (no tabs, proper `---` delimiters)
3. Confirm file location
4. Test with explicit trigger phrases

### YAML Errors

- Use spaces, never tabs
- Quote strings with special characters
- Proper `---` delimiters

### Path Issues

- Use forward slashes
- Verify paths exist
- Use `~` for home directory in personal skills

## Final Checklist

Before deploying a skill:

✓ Third-person description with specific trigger terms
✓ `SKILL.md` under 500 lines
✓ One-level-deep file references
✓ Consistent terminology throughout
✓ Concrete examples provided
✓ Progressive disclosure structure
✓ Clear workflows with steps
✓ Scripts with explicit error handling
✓ All package dependencies listed
✓ Tested across Haiku/Sonnet/Opus
✓ Real-world scenario validation

## Additional Resources

- [Claude Code Skills](https://docs.claude.com/en/docs/claude-code/skills.md)
- [Agent Skills Best Practices](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices.md)
