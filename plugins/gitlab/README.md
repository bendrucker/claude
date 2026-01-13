# GitLab Plugin

GitLab workflow best practices and glab CLI usage for Claude Code.

## Contents

- **Skill**: Guidance on GitLab workflows, merge requests, CI/CD, and glab CLI
- **Hook**: Transforms GitLab URLs into API requests for better content fetching

## Activation

The skill activates when working with GitLab repositories, `.gitlab-ci.yml`, or glab commands.

## Testing

```bash
shellspec plugins/gitlab/spec.sh
```
