---
name: glab
description: glab CLI basics and GitLab workflow overview. Use when working with GitLab repositories or adapting GitHub patterns to GitLab.
---
# glab

`glab` is the official GitLab CLI. This skill helps adapt GitHub (`gh`) patterns to GitLab.

## Terminology

- **Pull Request → Merge Request (MR)**: Use `glab mr` instead of `gh pr`
- **Repository → Project**: GitLab calls repositories "projects"
- **Actions → CI/CD**: Use `glab ci` for pipelines and jobs

## Key Rules

- Use `glab` for GitLab (never `gh`)
- Push branch before creating MR
- Use `--fill` to auto-populate from commits
