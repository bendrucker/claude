# Graphite

Graphite is a CLI tool and web service for managing stacked pull requests on GitHub. It provides an [`llms.txt`](https://graphite.dev/docs/llms.txt) index of its documentation. Its CLI is `gt`.

- Every command must include the `--no-interactive` flag to avoid prompts.
- With Graphite, instead of creating a new branch write away, you work towards a checkpoint and then `gt create <name>` to create a new branch.
- Use `gt add` to stage files.
- Use `gt modify` to modify the current PR in the stack.
- Use `gt log` to view the current stack of PRs.
- Use `gt track` if I'm on an existing branch and want to start stacking on top of it with Graphite.
- Use `gt help` to view available commands.
