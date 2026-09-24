---
fail: [short-close]
---
## Architecture

A minimal, dependency-free **Bun + TypeScript** CLI, no `package.json`/build system — just run directly with `bun src/cli.ts`. Data flow is linear: argv → parse → dispatch → domain logic → JSON storage/CSV export.

```
src/
├── cli.ts               entry point — reads process.argv, calls parseArgs() then run()
├── commands/
│   ├── parse.ts          argv → typed Command union (add | balance | export)
│   └── run.ts             dispatches Command via if-checks; loads/saves/prints
├── ledger/
│   ├── ledger.ts          core Ledger class: add() (immutable append), balance() (sum)
│   └── entry.ts           Entry interface — the record shape (amount, memo, at)
└── io/
    ├── store.ts            loadEntries()/saveEntries() — persists to ~/.ledger.json
    └── csv.ts              toCsv() — formats entries for `export` command
test/
└── ledger.test.ts          unit test for Ledger.balance()
```

**Key points:**
- **Storage**: flat JSON array at `~/.ledger.json`, no schema/versioning beyond the `Entry` interface — created lazily.
- **Dispatch**: no command registry/plugin system — `run.ts` uses sequential `if` on `cmd.kind`. Adding a new command means editing both `parse.ts` and `run.ts`.
- **Separation**: domain logic (`ledger/`) is decoupled from parsing (`commands/parse.ts`), execution (`commands/run.ts`), and I/O (`io/`).
- **Export vs. storage**: CSV (`io/csv.ts`) is one-way export only, not used for persistence.

Only 8 source files total, so the whole thing is easy to hold in your head. Let me know if you want a deeper look at any file, e.g. `commands/run.ts` for how commands are wired up.
