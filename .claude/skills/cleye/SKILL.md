---
name: cleye
description: Type-safe CLI argument parsing with cleye. Use when writing CLI scripts, adding flags or parameters to Bun scripts, or parsing command-line arguments.
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

## Subcommands

Pass to `cli()` via the `commands` array using the `command()` helper:

```ts
import { cli, command } from "cleye";

const argv = cli({
  name: "tool",
  commands: [
    command({ name: "build", flags: { watch: Boolean } }, (argv) => {
      console.log(argv.flags.watch);
    }),
  ],
});
```

For manual dispatch (used in this codebase), pass `args` as the third argument:

```ts
const argv = cli({ name: "errors", flags: { ... } }, undefined, args);
```

## Conventions

- Shebang: `#!/usr/bin/env bun`
- Entry point: wrap CLI logic in `if (import.meta.main)` so the module is importable
- Export core functions for programmatic use; keep CLI parsing at the entry point
- Use [cleye](https://github.com/privatenumber/cleye) (not `parseArgs` from `node:util`) for scripts that need `--help` generation
