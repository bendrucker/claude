---
name: graphite
description: Graphite CLI for managing stacked pull requests on GitHub. Use when working with stacked PRs, managing PR stacks, or using gt commands.
---
# Graphite

CLI tool for managing stacked pull requests on GitHub. Always use `--no-interactive` flag.

Workflow: Work towards a logical milestone, then `gt create` to create a new stack entry.

Commands:
- `gt add`: Stage files
- `gt create <name>`: Create stack entry, branch, and commit
- `gt submit`: Push stack and open/update PRs
- `gt modify`: Modify current PR
- `gt log`: View stack
- `gt track`: Track existing branch
- `gt restack`: Rebase stack
- `gt sync`: Fetch updates
