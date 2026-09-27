# Shell

A shell script's time goes to the commands it runs and the processes it forks. Find which commands, how many times each runs, and how long each takes. Shell startup (a `.zshrc` or `.bashrc`) is a script too, run on every new shell.

## Trace Each Command

Run the script with a timestamped xtrace, writing the trace apart from the script's own output.

bash (5 or newer for `EPOCHREALTIME`; macOS ships 3.2 as `/bin/bash`):

```bash
BASH_XTRACEFD=9 PS4='+ $EPOCHREALTIME ${BASH_SOURCE##*/}:${LINENO} ' bash -x <script> 9> tmp/profile/trace.log
```

zsh:

```zsh
zsh -x -c 'PS4="+%D{%s.%6.} %N:%i> "; source <script>' 2> tmp/profile/trace.log
```

Each line starts with a timestamp, so the gap to the next line is the time that command took. Rank the trace by gap, and also by count per command: a cheap command run a hundred times adds up. Nesting depth shows as repeated `+` characters, so a deep line's time also counts toward its callers.

## zsh Startup

Profile the config tree in question, isolated from the user's live one. Point `ZDOTDIR` at a temporary directory holding links to that tree's `.zshenv` and `.zshrc`. zsh reads `.zshenv` on every invocation, scripts included, and `.zshrc` only in interactive shells.

Rank zsh functions with `zprof`:

```zsh
zmodload zsh/zprof   # first line of .zshrc
zprof                # last line
```

Then run `ZDOTDIR=<dir> zsh -i -c exit`. The project may already gate this behind an environment variable and ship a formatter for the output, so check its startup files and scripts before adding one.

- `zprof` counts time inside zsh functions only. Top-level lines in sourced files, and the external commands they run, need the xtrace: add `setopt xtrace` with the `PS4` above at the top of `.zshenv`.
- `zsh -i -c exit` stops before the first prompt. Work deferred to a `precmd` hook or a deferred loader runs after it and never shows up. When the user feels the delay at the first prompt or first keystroke, measure that separately (see [the benchmark skill's shell reference](../../benchmark/references/shell.md)).

## bash Startup

`bash -i -c exit` with the xtrace above, pointed at the rc file with `--rcfile <file>` to profile a tree other than the live one.

## Common Costs

Look for these first in a startup or a hot loop:

- `eval "$(<tool> init)"`, `brew shellenv`, and similar lines run a process on every shell start to print text that rarely changes. Caching the output to a file keyed on the tool's version removes the process.
- `compinit` rebuilding or security-checking the completion dump on every start.
- Command substitutions (`$(...)`) and pipelines inside loops, each of which forks.
- Version managers and shims that resolve a tool on every call, which multiplies across a script calling that tool many times.

## Children

`samply` follows every process a script spawns and reports each one's wall span and CPU ([samply.md](samply.md)). On macOS it cannot attach to `/bin/sh`, `/bin/bash`, or `/bin/zsh`, so start the script with a shell outside `/bin` when one exists (`command -v bash`). Children that are SIP binaries (`/usr/bin/*`) drop out of the profile. The xtrace covers them.

## System Tracing

System tracers see every exec and file access, including processes a profiler cannot attach to: `strace -f` on Linux, `fs_usage` and `eslogger` on macOS. The macOS tools need `sudo`, so ask the user before using them and hand them the command to run:

```bash
strace -f -tt -e trace=execve,openat -o tmp/profile/strace.log <command>
sudo fs_usage -w -f exec,filesys <process-name>
sudo eslogger exec > tmp/profile/exec.jsonl
```

Use these only when the xtrace and `samply` leave a gap.
