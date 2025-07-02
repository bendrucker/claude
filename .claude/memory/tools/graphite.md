# Graphite

Graphite is a CLI tool and web service for managing stacked pull requests on GitHub. It provides an [`llms.txt`](https://graphite.dev/docs/llms.txt) index of its documentation. Its CLI is `gt`.


- Every command must include the `--no-interactive` flag to avoid prompts.
- With Graphite, instead of creating a new branch write away, you work towards a checkpoint and then commit it to a new branch. **Do not** create an empty branch to start.


- `gt add`: Stage files
- `gt create <name>`: Create a new stack entry by name. Creates a branch and commits the staged changes.
- `gt submit` Push the stack up to the current entry and open pull requests for new entries or update existing ones.
- `gt modify`: modify the current PR in the stack
- `gt log`: view the current stack of PRs
- `gt track`: Track an existing branch created outside of Graphite
- `gt help`: view available commands
- `gt restack`: rebase the current stack entry and all entries below
- `gt sync`: fetch new data from Graphite, updating any branches that have changed
