# Writing

Style enforcement and slop detection for prose a person reads.

Documents a model executes belong to the [prompting](../prompting) plugin. [`.claude/rules/plugins.md`](../../.claude/rules/plugins.md) states the audience rule.

## Contents

- **Hooks**: `hooks/lint.ts` lints outgoing messages and edited files with Vale, and `hooks/sessionstart.ts` syncs the pinned Vale packages
- **Skills**: `writing`, `no-diary`, `review`, `scan`, `analyze`
- **Agents**: `content`, `style`, `artifacts`

## Testing

```sh
bun test plugins/writing
```
