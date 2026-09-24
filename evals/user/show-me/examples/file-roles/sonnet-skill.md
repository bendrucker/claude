---
fail: [file-tree]
---
It's a small Bun/TypeScript CLI with a clean layered structure:

**Entry point**
- `src/cli.ts` — parses `process.argv` and hands off to `run()`. The whole app in 4 lines.

**Commands** (CLI-facing logic)
- `src/commands/parse.ts` — turns raw argv into a typed `Command` union: `add`, `balance`, or `export`.
- `src/commands/run.ts` — the dispatcher. Loads entries from disk, builds a `Ledger`, executes the matching command (add/print balance/export CSV), persists if needed.

**Domain model**
- `src/ledger/entry.ts` — the `Entry` type (`amount`, `memo`, `at` timestamp). No behavior.
- `src/ledger/ledger.ts` — the `Ledger` class: pure domain logic, `add()` (returns new entry array, immutable-style) and `balance()` (sum reducer). No I/O.

**I/O layer**
- `src/io/store.ts` — reads/writes the ledger as JSON at `~/.ledger.json` using Bun's file APIs.
- `src/io/csv.ts` — serializes entries to CSV for the `export` command.

**Tests**
- `test/ledger.test.ts` — one Bun test covering `Ledger.balance()`.

Data flow: `cli.ts` → `parse.ts` (argv → Command) → `run.ts` (orchestrates) → `ledger.ts` (business logic) + `store.ts`/`csv.ts` (persistence/export).

A couple of things worth knowing as you take this over: there's no validation on `add` (e.g. `Number(rest[0])` can silently become `NaN`), and the whole ledger is a single flat JSON file with no locking — fine for a personal CLI, but worth keeping in mind if you extend it.
