# webfetch-block

Catch-all hook for blocking WebFetch on authenticated services without dedicated plugins.

## Scope

Only add domains here when:
- The service requires authentication for useful content
- No plugin exists that provides authenticated access (via MCP or CLI)

Services with plugins (GitHub, GitLab, Linear) handle their own WebFetch blocking and provide specific guidance for their tools.
