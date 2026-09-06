# Raycast Extensions

A fork of the upstream monorepo, sparsely checked out. I maintain `extensions/things` and `extensions/herdr`. Add another with `git sparse-checkout add extensions/<name>`.

- To run or preview an extension, use the `raycast:develop` skill.
- To prepare a release, use the `raycast:publish` skill, then `/ship` to open the PR.
- Never run `npm run publish`. It opens a pull request against `raycast/extensions` on its own.
