---
name: cleye
description: Type-safe CLI argument parsing with cleye, the standard parser for this repo's Bun scripts. Use when writing or editing any script that takes arguments (flags, positional parameters, subcommands, --help) instead of reading existing scripts for the pattern.
---

# cleye

Type-safe CLI argument parsing for Bun scripts. Used across plugin scripts for flags, parameters, and subcommands.

## Basic Usage

```ts
#!/usr/bin/env bun

import { cli } from "cleye";

const argv = cli({
  name: "my-script",
  parameters: ["<file>"],
  flags: {
    output: {
      type: String,
      alias: "o",
      description: "Output path",
    },
    verbose: Boolean,
  },
});

console.log(argv._.file);       // string (required)
console.log(argv.flags.output); // string | undefined
console.log(argv.flags.verbose); // boolean | undefined
```

## Parameters

Positional arguments mapped to named properties on `argv._`:

```ts
parameters: [
  "<required>",     // must be provided
  "[optional]",     // may be omitted
  "<files...>",     // required variadic (1+), must be last
  "[files...]",     // optional variadic (0+), must be last
]
```

Required parameters must precede optional. Variadic must be last.

Access: `argv._.required`, `argv._.optional`, `argv._.files`.

## Flags

Flags accept a type constructor or a config object:

```ts
flags: {
  name: String,                    // shorthand
  count: {
    type: Number,
    alias: "n",
    default: 10,
    description: "Max results",
  },
  tags: {
    type: [String],                // array: -t foo -t bar
    description: "Tag names",
  },
  json: {
    type: Boolean,
    description: "Output as JSON",
  },
}
```

Kebab-case flags (`--dry-run`) become camelCase properties (`argv.flags.dryRun`).

## Help Text

Set `help.description` on `cli()` for a summary line above the generated usage block:

```ts
const argv = cli({
  name: "scan",
  parameters: ["<path>"],
  help: {
    description: "Scan repository prose for AI writing tropes.",
  },
  flags: { ... },
});
```

## Subcommands

Define each subcommand as a named `command()` const with its callback, pass them via the `commands` array, and give the root `cli()` a callback that shows help when no subcommand matches:

```ts
import { cli, command } from "cleye";

const replyCmd = command(
  {
    name: "reply",
    parameters: ["<thread-id>"],
    flags: {
      body: { type: String, description: "Reply text" },
    },
  },
  async (parsed) => {
    console.log(parsed._.threadId, parsed.flags.body);
  },
);

cli(
  {
    name: "review-threads",
    commands: [replyCmd],
  },
  (parsed) => {
    parsed.showHelp();
  },
);
```

## Conventions

- Shebang: `#!/usr/bin/env bun`
- Entry point: wrap CLI logic in `if (import.meta.main)` so the module is importable
- Export core functions for programmatic use; keep CLI parsing at the entry point
- Use [cleye](https://github.com/privatenumber/cleye) (not `parseArgs` from `node:util`) for scripts that need `--help` generation
