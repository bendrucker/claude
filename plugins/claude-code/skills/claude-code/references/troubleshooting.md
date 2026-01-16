# Troubleshooting

## Skill Not Activating

- Verify description includes specific trigger terms
- Check YAML syntax (no tabs, proper `---` delimiters)
- Confirm file location (`~/.claude/skills/` or `.claude/skills/`)
- Test with explicit trigger phrases
- For syntax questions, use Task tool with `subagent_type='claude-code-guide'`

## YAML Errors

- Use spaces, never tabs
- Quote strings with special characters
- Proper `---` delimiters at start and end of frontmatter

## Path Issues

- Use forward slashes everywhere (not Windows-style)
- Verify paths exist
- Use `~` for home directory in personal skills

## Plugin Skills Not Appearing

Clear plugin cache and reinstall:

```bash
rm -rf ~/.claude/plugins/cache
```

Restart Claude Code and reinstall:

```
/plugin install plugin-name@marketplace-name
```

Verify directory structure:

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json
└── skills/
    └── my-skill/
        └── SKILL.md
```

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
