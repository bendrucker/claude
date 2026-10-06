# Troubleshooting

## Skill Not Activating

- Verify the description includes specific trigger terms, then test with explicit trigger phrases
- Check YAML frontmatter syntax and file location (`~/.claude/skills/` or `.claude/skills/`)
- For syntax questions, use the `Agent` tool with `subagent_type='claude-code-guide'`

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
