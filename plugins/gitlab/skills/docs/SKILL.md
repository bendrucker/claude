---
name: docs
description: Browsing GitLab documentation efficiently. Use when you need to look up GitLab features, configuration, API details, or CI/CD syntax.
---
# GitLab Docs

Guide for navigating [GitLab documentation](https://docs.gitlab.com/).

## CLI Commands: Use --help

For `glab` command reference, use `--help` instead of web docs:

```bash
glab mr --help          # List subcommands
glab mr create --help   # Command options and flags
```

The `/cli/` web docs duplicate CLI help output.

## When to Use Web Docs

| Need | Path |
|------|------|
| CI/CD YAML syntax | `/ci/yaml/` |
| API endpoints | `/api/` |
| Feature concepts | `/topics/` |
| UI configuration | `/user/` |
| Self-managed admin | `/administration/` |

## Common Paths

- `/ci/yaml/` - Pipeline keywords
- `/ci/variables/` - Predefined variables
- `/api/merge_requests/` - MR API fields
- `/api/graphql/reference/` - GraphQL schema
