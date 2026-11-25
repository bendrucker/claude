---
name: steward
description: House rules for PR Steward and the /steward watch in this repository
user-invocable: false
disable-model-invocation: true
---

# Steward

- Before a push, run `prek run --files <changed files>`, which runs the plugin tests, validators, and skill lint for what changed.
- A PR that touches a native eval suite, or a plugin or `user/` skill a suite loads, runs that suite in CI once it carries the `eval` label. Add the label only when the PR body claims eval results the suite should confirm.
- A pull request touching `user/settings.json` `pluginConfigs` or a `plugin.json` `userConfig` often conflicts with its siblings. Both sides are additive, so resolve by keeping every key.
