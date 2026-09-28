---
name: cli
description: Type-safe CLI argument parsing with commander and @commander-js/extra-typings, the standard parser for this repo's Bun scripts. Use when writing or editing any script that takes arguments (flags, positional parameters, subcommands, nested subcommands, --help) instead of reading existing scripts for the pattern.
---

# CLI

New scripts parse arguments with [commander](https://github.com/tj/commander.js) through [`@commander-js/extra-typings`](https://github.com/commander-js/extra-typings), which infers each option's and argument's type from its flag string. Scripts still on cleye migrate to commander over time.

Import `Command`, `Option`, and the error classes from `@commander-js/extra-typings`. Importing them from `commander` drops the inference and types every option as `any`.

## Basic Usage

```ts
#!/usr/bin/env bun

import { Command, Option } from "@commander-js/extra-typings";

export const program = new Command("scan")
  .description("Scan repository prose for AI writing tropes.")
  .argument("<path>", "directory to scan")
  .option("-o, --output <file>", "output path")
  .addOption(new Option("--format <format>", "output format").choices(["text", "json"]).default("text"))
  .option("--dry-run", "report without writing")
  .action((path, options) => {
    console.log(path); // string
    console.log(options.output); // string | undefined
    console.log(options.format); // "text" | "json"
    console.log(options.dryRun); // true | undefined
  });

if (import.meta.main) {
  await program.parseAsync();
}
```

The action receives each declared argument in order, then the options object, then the command. Reading an undeclared key such as `options.outptu` is a type error.

`parseAsync` handles `--help` and `-h`, and awaits an async action. A missing argument, an unknown option, an excess positional, or a value outside `choices` prints an error and exits 1.

## Options

| Declaration | Type |
| --- | --- |
| `--name <value>` | `string \| undefined` |
| `--flag` | `true \| undefined` |
| `--no-color` | `boolean`, default `true` |
| `--since [date]` | `string \| true \| undefined` |
| `.requiredOption("--repo <r>")` | `string` |
| `.option("--limit <n>", "…", int, 20)` | `number` |
| `.argument("<path>")` | `string` |
| `.argument("[files...]")` | `string[]` |

A default or `requiredOption` drops `undefined` from the type. A kebab-case flag (`--dry-run`) arrives as a camelCase key (`dryRun`). An enum needs `addOption` with `new Option(...).choices([...])`, which types the value as the union.

### Numbers and Repeated Flags

Commander has no number type and keeps only the last value of a repeated flag. Pass a parser function as the third argument for both:

```ts
#!/usr/bin/env bun

import { Command, InvalidArgumentError } from "@commander-js/extra-typings";

function int(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new InvalidArgumentError("Not an integer.");
  return n;
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export const program = new Command("search")
  .option("-n, --limit <n>", "maximum results", int, 20)
  .option("--tag <name>", "tag to match, repeatable", collect, [])
  .requiredOption("--label <name>", "label to apply, repeatable", collect)
  .action((options) => {
    console.log(options.limit); // number
    console.log(options.tag); // string[]
    console.log(options.label); // string[]
  });

if (import.meta.main) {
  await program.parseAsync();
}
```

- Copy `int` and `collect` into each script that uses them. A distributed plugin cannot import them from another plugin or a workspace package, and they are too small to publish.
- A required repeated flag takes `collect` with no default. `requiredOption` counts a `[]` default as present and never reports the flag missing.
- An `InvalidArgumentError` thrown from a parser prints `error: option '...' argument '...' is invalid. <message>` and exits 1.
- Use `collect` for repeated flags instead of a variadic option (`--tag <names...>`), which also absorbs every positional that follows it.

## Subcommands

Build each command with `new Command(name)` and attach it with `addCommand`. A group is a command whose children are its actions, so `watch-session trial start` nests with no extra wiring:

```ts
#!/usr/bin/env bun

import { Command } from "@commander-js/extra-typings";

export const start = new Command("start")
  .description("Start a trial.")
  .option("--name <name>", "trial name", "trial")
  .argument("<command...>", "command to run, with its arguments")
  .passThroughOptions()
  .action((forward, options) => {
    console.log(options.name, forward);
  });

const end = new Command("end").description("End a trial.").action(() => {
  console.log("ended");
});

const trial = new Command("trial")
  .description("Start or end a trial.")
  .enablePositionalOptions()
  .addCommand(start)
  .addCommand(end);

export const program = new Command("watch-session").enablePositionalOptions().addCommand(trial);

if (import.meta.main) {
  await program.parseAsync();
}
```

- A group without an action prints its usage and exits 1 when invoked without a subcommand.
- Options declared on a group belong to the group, and must precede the subcommand under `enablePositionalOptions()`. A leaf reads them with `command.optsWithGlobals()`, which types them only when the group's `.command(name)` created the leaf. A leaf attached with `addCommand` gets them at runtime without the types.
- `--` does not reach the action as its own value. `[forward...]` holds the operands before `--` and after it with no boundary between them, so a stray positional before `--` gets forwarded.
- To forward arguments to another program, declare `<command...>` and call `passThroughOptions()` on the leaf. Everything from the first positional onward forwards verbatim, including flags, so `start --name x git diff --stat` and `start --name x -- git diff --stat` both forward `git diff --stat`.
- Bun drops a `--` that comes first after the script path, so `./tool.ts -- git --stat` reaches commander as `git --stat`. `passThroughOptions()` forwards both spellings the same way.
- `passThroughOptions()` requires `enablePositionalOptions()` on every ancestor, and throws at parse time when one lacks it.

## Testing

Call `exitOverride()` and `configureOutput()` on every command in the tree. `addCommand` does not copy them to children. With both set, a parse error or `--help` throws a `CommanderError` carrying `code` and `exitCode` instead of exiting, and output lands in the test.

```ts
import { CommanderError, type CommandUnknownOpts } from "@commander-js/extra-typings";
import { expect, test } from "bun:test";
import { program, start } from "./watch-session";

async function run(command: CommandUnknownOpts, argv: string[]): Promise<string> {
  let output = "";
  const configure = (cmd: CommandUnknownOpts): void => {
    cmd.exitOverride().configureOutput({
      writeOut: (text) => {
        output += text;
      },
      writeErr: (text) => {
        output += text;
      },
    });
    for (const sub of cmd.commands) configure(sub);
  };
  configure(command);
  await command.parseAsync(argv, { from: "user" });
  return output;
}

test("forwards the command after the leaf's options", async () => {
  await run(program, ["trial", "start", "--name", "x", "--", "git", "diff"]);
  expect(start.opts().name).toBe("x");
  expect(start.processedArgs).toEqual([["git", "diff"]]);
});

test.each<{ name: string; argv: string[]; code: string; exitCode: number }>([
  { name: "unknown subcommand", argv: ["trial", "nope"], code: "commander.unknownCommand", exitCode: 1 },
  { name: "help", argv: ["--help"], code: "commander.helpDisplayed", exitCode: 0 },
])("$name exits through CommanderError", async ({ argv, code, exitCode }) => {
  const failure = await run(program, argv).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(CommanderError);
  expect(failure).toMatchObject({ code, exitCode });
});
```

- Pass `{ from: "user" }` so commander reads `argv` as arguments only, with no runtime and script path in front.
- `parseAsync` resolves to the command, not the action's return value. Assert on a leaf's typed `opts()` and `processedArgs`, or on the exported core functions the action calls.
- Reparsing the same program is safe. Commander restores option defaults before each parse.

## Conventions

- Shebang: `#!/usr/bin/env bun`
- Entry point: call `await program.parseAsync()` inside `if (import.meta.main)` so the module is importable.
- Export the root program, any leaf a test inspects, and the core functions. Keep argument parsing in the command definitions.
- A distributed plugin declares both `commander` and `@commander-js/extra-typings` in its own `package.json` at the same `~15.0.0` range, then regenerates its lockfile with `bun run plugin-lockfiles generate`. `extra-typings` pins its `commander` peer to one minor line, so the two upgrade together. Renovate groups them into one PR.
