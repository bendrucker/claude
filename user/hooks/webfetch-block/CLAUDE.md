# webfetch-block

Catch-all hook for blocking WebFetch on URLs that won't return useful content.

## Scope

Add patterns here when:
- The service requires authentication and no plugin provides access (via MCP or CLI)
- The domain doesn't exist (hallucinated URLs)
- The site blocks bot/automated requests

Services with plugins (GitHub, GitLab, Linear) handle their own WebFetch blocking and provide specific guidance for their tools.
