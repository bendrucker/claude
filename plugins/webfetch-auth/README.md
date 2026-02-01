# WebFetch Auth

Blocks WebFetch for URLs that require authentication and suggests MCP alternatives.

## Contents

- **Hook**: PreToolUse hook that intercepts WebFetch calls

## Authenticated Domains

| Domain | Alternative |
|--------|-------------|
| `docs.google.com` | Google Drive MCP or export as PDF |
| `*.atlassian.net` | Confluence/Jira MCP |
| `*.notion.so` | Notion MCP |
| `linear.app` | Linear MCP (`linear:linear` skill) |

## Testing

```sh
bun test plugins/webfetch-auth
```
