---
name: cli
description: Type-safe CLI argument parsing with citty, the standard parser for this repo's Bun scripts. Use when writing or editing any script that takes arguments (flags, positional parameters, subcommands, nested subcommands, --help) instead of reading existing scripts for the pattern.
---

# CLI

New scripts parse arguments with [citty](https://github.com/unjs/citty). Older scripts still use cleye.

## Basic Usage

```ts
#!/usr/bin/env bun

import { defineCommand, runMain } from "citty";

export const main = defineCommand({
  meta: { name: "scan", description: "Scan repository prose for AI writing tropes." },
  args: {
    path: { type: "positional", required: true, description: "Directory to scan" },
    output: { type: "string", alias: "o", description: "Output path" },
    format: { type: "enum", options: ["text", "json"], default: "text", description: "Output format" },
    verbose: { type: "boolean", description: "Print every match" },
  },
  run({ args }) {
    console.log(args.path);    // string
    console.log(args.output);  // string | undefined
    console.log(args.format);  // "text" | "json"
    console.log(args.verbose); // boolean | undefined
  },
});

if (import.meta.main) {
  await runMain(main);
}
```

`runMain` handles `--help`/`-h`, and `--version` when `meta.version` is set. A missing required argument, an invalid enum value, or an unknown subcommand prints usage and exits 1.

## Args

Each key in `args` takes a `type`:

- `string`: `--name value` or `--name=value`
- `boolean`: `--flag`
- `enum`: `--mode a`, validated against `options`, typed as their union
- `positional`: matched in declaration order

`required: true` or a `default` narrows the type to exclude `undefined`. A camelCase key (`dryRun`) accepts the kebab-case flag (`--dry-run`).

Typing gaps to work around:

- No number type. Declare `string` and convert with `Number()`, rejecting `NaN`.
- No repeated flag. `--tag a --tag b` keeps the last value. Take a comma-separated string and split it.
- No variadic positional. `args._` holds every positional value plus everything after `--`.
- Parsed args carry an index signature, so a misspelled key type-checks as `string | number | boolean | string[]`. Read only the keys declared in `args`.

## Subcommands

Pass commands to `subCommands`. A group is a command whose `subCommands` holds its actions, so `tool trial start` nests with no extra wiring:

```ts
import { defineCommand, runMain } from "citty";

const start = defineCommand({
  meta: { name: "start", description: "Start a trial." },
  args: {
    name: { type: "string", default: "trial", description: "Trial name" },
  },
  run({ args, rawArgs }) {
    const forwarded = rawArgs.includes("--") ? rawArgs.slice(rawArgs.indexOf("--") + 1) : [];
    console.log(args.name, forwarded);
  },
});

const end = defineCommand({
  meta: { name: "end", description: "End a trial." },
  run() {},
});

const trial = defineCommand({
  meta: { name: "trial", description: "Start or end a trial." },
  subCommands: { start, end },
});

export const main = defineCommand({
  meta: { name: "watch-session" },
  subCommands: { trial },
});
```

- A group without `run` prints its usage when invoked without an action.
- `rawArgs` is relative to the command that runs, so a leaf that forwards arguments to another program slices it after `--`.
- `setup` and `cleanup` hooks run around `run` on every command in the path.

## Testing

`runCommand(main, { rawArgs: ["trial", "start", "--name", "x"] })` runs the full command path without `process.argv` or `process.exit`, and throws `CLIError` on a usage error. It does not return a nested leaf's `run` value, so assert on the exported core functions or on side effects.

## Conventions

- Shebang: `#!/usr/bin/env bun`
- Entry point: call `runMain` inside `if (import.meta.main)` so the module is importable
- Export the root command and core functions. Keep parsing in the command definitions
- A distributed plugin declares `citty` in its own `package.json` and regenerates its lockfile with `bun run plugin-lockfiles generate`
