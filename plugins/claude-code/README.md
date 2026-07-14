# claude-code

Meta-tools for Claude Code configuration and customization.

## Skills

- **agent-team**: Orchestrating teams of Claude Code sessions with shared tasks, messaging, and coordination
- **handoff**: Hand the current conversation off to a fresh background agent that picks up the work immediately, so you can step away and track it independently
- **hook**: Configuring, creating, and troubleshooting Claude Code hooks
- **session**: Search and analyze Claude Code conversation history via DuckDB. Named queries for session search, tool stats, errors, permission rejections, and sandbox bypass tracking
- **skill**: Creating and optimizing Claude Code Skills including activation patterns, content structure, and development workflows

## Testing

```bash
bun test plugins/claude-code/
```
