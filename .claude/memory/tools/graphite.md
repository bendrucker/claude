# Graphite

CLI tool for managing stacked pull requests on GitHub. Always use `--no-interactive` flag.

Workflow: Work towards a checkpoint, then commit to a new branch. **Do not** create empty branches.

Commands:
- `gt add`: Stage files
- `gt create <name>`: Create stack entry, branch, and commit
- `gt submit`: Push stack and open/update PRs
- `gt modify`: Modify current PR
- `gt log`: View stack
- `gt track`: Track existing branch
- `gt restack`: Rebase stack
- `gt sync`: Fetch updates
