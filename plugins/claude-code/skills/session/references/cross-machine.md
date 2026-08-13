# Cross-Machine Import

Procedures for listing, importing, re-syncing, and forgetting another machine's session history. Host semantics and the egress policy live in [`SKILL.md`](../SKILL.md) "Cross-Machine History". Read that first.

## Listing Hosts

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/hosts.ts
```

Shows each host with its import time, egress policy, last index, rsync source, and a ready-to-run re-sync command.

## Importing a Machine

Copy the source machine's `~/.claude/projects/` into the import root, then register it. The `!` prefix runs the commands in the user's own shell, so SSH host-key trust and any 2FA stay in their hands.

```bash
mkdir -p ~/.claude/session-imports/<label>/projects
rsync -avn --update <user@host>:.claude/projects/ ~/.claude/session-imports/<label>/projects/   # dry run
rsync -av  --update <user@host>:.claude/projects/ ~/.claude/session-imports/<label>/projects/   # real copy
bun ${CLAUDE_SKILL_DIR}/scripts/import.ts --host <label> --source '<user@host>:.claude/projects/'
```

`import.ts` writes a manifest (dirs `0700`, manifest `0600`) recording the label, `--source`, and egress policy, then re-indexes. The whole `projects/` tree is copied even though only `*.jsonl` is indexed, because that tree is also the re-sync unit.

## Re-syncing

The source stored in the manifest doubles as the re-sync input, so refreshing is the same rsync line followed by `import.ts`:

```bash
rsync -av --update <source> ~/.claude/session-imports/<label>/projects/
bun ${CLAUDE_SKILL_DIR}/scripts/import.ts --host <label>
```

Re-running `import.ts` on a registered host leaves its manifest intact and re-indexes only the changed files. Change detection is a per-file catalog keyed on path plus (mtime, size), so `rsync -a` preserving old source mtimes is not a problem: a newly delivered file is a new path, and an updated file differs in mtime or size. `hosts.ts` prints the exact line per host.

## Forgetting a Machine

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/forget.ts --host <label>
```

Deletes the host's rows from the index and removes its synced files. `local` cannot be forgotten.
