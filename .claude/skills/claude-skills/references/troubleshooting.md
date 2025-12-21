# Troubleshooting

## Skill Not Activating

1. Verify description includes specific trigger terms
2. Check YAML syntax (no tabs, proper `---` delimiters)
3. Confirm file location (`~/.claude/skills/` or `.claude/skills/`)
4. Test with explicit trigger phrases
5. For syntax questions, use Task tool with `subagent_type='claude-code-guide'`

## YAML Errors

- Use spaces, never tabs
- Quote strings with special characters
- Proper `---` delimiters at start and end of frontmatter

## Path Issues

- Use forward slashes everywhere (not Windows-style)
- Verify paths exist
- Use `~` for home directory in personal skills

## Deployment Checklist

Before deploying:

- [ ] Third-person description with specific trigger terms
- [ ] `SKILL.md` under 500 lines
- [ ] One-level-deep file references
- [ ] Consistent terminology throughout
- [ ] Concrete examples provided
- [ ] Progressive disclosure structure
- [ ] Clear workflows with steps
- [ ] Scripts with explicit error handling
- [ ] All package dependencies listed
- [ ] Tested across Haiku/Sonnet/Opus
- [ ] Real-world scenario validation
