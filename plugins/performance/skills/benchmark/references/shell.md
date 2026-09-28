# Shell

## Scripts

Benchmark a shell script through `hyperfine` like any other command. Leave out `-N` when the command needs a shell to parse it. `hyperfine` then subtracts its own shell's startup from each sample.

## Startup

Measure interactive startup with `hyperfine 'zsh -i -c exit'` (or `bash -i -c exit`).

- Compare config trees by giving each arm its own `ZDOTDIR` (zsh) or `--rcfile` (bash) that points at that tree's startup files. Measuring the live config picks up whatever the user changed since.
- Run warmup rounds. The first start after a change rebuilds caches such as the completion dump, and later starts reuse them.
- `-i -c exit` stops before the first prompt. Work deferred to `precmd` hooks or a deferred loader escapes it, even though the user waits for it. When deferred work matters, measure time to first prompt with a tool built for it, such as [`zsh-bench`](https://github.com/romkatv/zsh-bench), which drives a real terminal and reports first-prompt and first-command latency.
- Check the project for an existing startup benchmark before building one. A harness the user already trusts sets the scenario.

## Fast Signals

Count processes forked during startup with the xtrace or a system tracer ([the profile skill's shell reference](../../profile/references/shell.md)). The count is deterministic, and each fork removed saves a few milliseconds.
