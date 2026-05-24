# Cross-Machine Session History

Status: design draft. Not implemented. Intended as input for a future refinement session.

## Motivation

I have Claude Code session history on multiple machines: a personal machine and a work machine, each with its own `~/.claude/projects/<encoded-path>/<session-id>.jsonl` corpus. I want to query across them as a single corpus — initially for things like AI writing-trope analysis (n-grams, phrase-lift comparisons, "what did I correct the assistant about?"), but the cross-machine view is broadly useful.

Today the session plugin indexes from a single local directory. The next time I want to run an analysis that needs both machines, I'd like the workflow to be cheap and repeatable, not a one-off scp.

## Constraints

1. **Lightweight, not heavy infrastructure.** No daemon, no cloud sync service, no shared database. Belongs as guidance and small tools in or near the session plugin, not as a service.
2. **Local access is fine, network access is slow.** SSHFS-style "stream every read over the network" is unacceptable; copying once and operating on local files is fine.
3. **The skill is the surface.** The user-facing way to use this should be through the `session` skill: clear guidance for the assistant on how to fetch, query, and clean up cross-machine data.
4. **Security.** Sessions contain credentials, PII, internal codenames, and customer data. Anything copied to temp storage must be permission-restricted and have a clearly documented scrub path. Default to opt-in, not auto-sync.
5. **Identification.** Queries should be able to tell which machine a row came from. The current rows don't carry a host/source field, so we'll need to add one (or derive it from the import path).

## Plugin location note

The motivation refers to `plugins/session/`. The plugin actually lives at `plugins/claude-code/skills/session/` (a nested-skill plugin). All path references below use the real path.

## Coordination with other in-flight work

A separate worktree is drafting `text_content`, `text-export`, `phrase-lift`, and `correction-candidates` (branch suggestion: `session-trope-analysis-views`). The design here assumes that branch lands first or in parallel. Specifically:

- We add a `host` column upstream of `text_content`. Any view downstream of `raw` / `messages` inherits the column without code changes if it uses `SELECT *` patterns, and needs a trivial fix-up otherwise.
- The trope-analysis queries should accept a `host` parameter the same way they accept `project`, by adding a row to the `host_filter` macro list. We pre-declare the macro here so that the other branch only has to use it.

This document does not touch the trope-analysis files. The migration sketch in `Recommended approach` below shows what changes when both branches land together.

## Considered approaches

Each axis is treated independently; the recommended approach is the combination called out at the end.

### Acquisition: how does the second machine's history get here?

| Option | Pros | Cons |
|---|---|---|
| **A1. One-shot `scp`/`rsync` invoked by the user, then `session import <local-dir> --host <label>`** | Zero new network logic in the plugin. User stays in control of credentials and host reachability. Works over any transport the user already has (1Password SSH agent, jump hosts, Tailscale, etc.). | User has to remember two steps. No automatic diff on subsequent fetches. |
| **A2. `session sync <user@host> --host <label>`** wraps `rsync -av --update` over SSH | Single command. `--update` makes repeat runs cheap. Mtime-based, matches the existing index refresh logic. | Plugin now has an SSH dependency surface (key location, agent forwarding, `~/.ssh/config` aliases). Failures look like plugin bugs even when they're network/SSH issues. |
| **A3. `session sync` via `restic`/`borg` snapshot of `~/.claude/projects/`** | Deduped, incremental, encrypted at rest by default. Restic in particular handles "many small files" well and has a `restore --include` so we don't have to pull non-session state. | Adds a real dependency (restic/borg). User has to maintain a repo. Total overkill for "two machines, my sessions." |
| **A4. SSHFS / sshfs-mac** | No copy step. Always fresh. | Rejected by constraint 2: streams every DuckDB read over the network. `read_json_objects` over a 200MB corpus will be unusably slow, and the refresh logic relies on accurate mtimes that some SSHFS configurations don't preserve. |
| **A5. `session import` reads a directory the user has already populated however they want (rsync, scp, USB stick, Syncthing, Git Annex)** | Same as A1 but explicit that the plugin doesn't care how files arrive. The smallest surface area. | Same as A1: two steps, no built-in diff. |

### Storage layout

| Option | Pros | Cons |
|---|---|---|
| **S1. Permanent: `~/.claude/session-imports/<host-label>/projects/...`** | Parallel to the local `~/.claude/projects/`. Easy to reason about. Survives reboots so subsequent analyses don't re-fetch. Can be scrubbed by `rm -rf` of a single labeled directory. | Lives in `~/.claude`, which the user may treat as Claude-managed. Could be backed up unintentionally. Permanent presence raises the leakage risk the longer it sits. |
| **S2. Ephemeral: `$TMPDIR/session-imports-<host>/...`** | Clear "this is temporary" signal. Wiped on reboot on macOS (modulo `TMPDIR` quirks). | Re-fetched every time. Slow. The DuckDB index, which lives elsewhere, will retain rows pointing at deleted files until refreshed. |
| **S3. Mixed: persistent metadata in `~/.claude/session-imports/<host>/manifest.json`, ephemeral payload in `$TMPDIR/session-imports/<host>/projects/...`** | Cheap re-hydrate (manifest knows what was previously fetched), but raw JSONL never sits on disk longer than needed. | More code. Most analyses run within minutes, so the persistence benefit is small. |
| **S4. `$XDG_DATA_HOME` (or `~/Library/Application Support/claude-code/session-imports/`) outside `~/.claude`** | Decouples imported corpus from Claude-managed state. Less likely to be backed up alongside local sessions. | Yet another path the user has to remember. macOS app support paths don't feel right for hand-edited content. |

### Indexing model

| Option | Pros | Cons |
|---|---|---|
| **I1. Single DB, `host` column on `raw` (pinned, like `session_id`), inherited by all views** | Single source of truth. Queries that don't care about host keep working. Queries that do care add `WHERE host = 'work'`. Fits the existing pinned-schema invariant. | Requires a migration. Cross-host session-id collisions become real (see Identity drift). |
| **I2. One DB per host, attached via DuckDB `ATTACH`** | Strong isolation. `session forget` is `rm` of a single `.duckdb` file. Easy to skip a host without dropping rows. | Every query becomes a `UNION ALL` across attached DBs, or a templated view. Schema drift between DBs (e.g., one machine on an older `views.sql`) silently breaks queries. |
| **I3. Single DB, host derived from `source_file` prefix at query time** | No migration. | Every query has to know the path-to-host mapping. `source_file` prefix is fragile (user can move imports). No way to pin a clean host label like `"work"` vs. `/Users/ben/.claude/session-imports/work/...`. |

### Skill surface

| Option | Pros | Cons |
|---|---|---|
| **K1. New `query.ts` subcommands: `import`, `sync`, `forget`, `list-hosts`** | Discoverable via `query.ts --help`. Co-located with the existing CLI. | Inflates `query.ts`; mixes index management with query execution. |
| **K2. Separate scripts in `scripts/`: `import.ts`, `forget.ts`, `hosts.ts`. SKILL.md guides the assistant to invoke them.** | Clean separation. Each script is independently testable. Matches existing patterns (one script per concern). | More files. SKILL.md has to know about more entry points. |
| **K3. SKILL.md guidance only, no new CLI (assistant writes ad-hoc `rsync` and `INSERT INTO host_registry` SQL).** | Zero new code. | High variance in what the assistant does. Brittle. Defeats the point of the skill. |

### Security & scrub

| Option | Pros | Cons |
|---|---|---|
| **C1. `0700` on import dirs, `0600` on imported files, `session forget <host>` does `rm -rf` plus `DELETE FROM raw WHERE host = ?` then rebuilds views** | Explicit, reviewable. Two-stage scrub (filesystem and index) matches the two-stage state. | Requires the user to run `forget`. Old rows linger if they don't. |
| **C2. Auto-scrub on session exit via Stop hook** | Truly ephemeral. Matches `$TMPDIR` ergonomics. | Hooks running `rm -rf` are scary. A bug here deletes the user's work corpus. Also: cross-session analyses (refine over multiple Claude sessions) become impossible. |
| **C3. Time-based expiry: `session forget --older-than 7d` plus a per-host `imported_at` timestamp** | Lets long-running analyses persist while bounding leakage. | Yet another dimension. Easy to skip. |
| **C4. Credential sniff: regex for `sk_live_`, `xoxb-`, `ghp_`, `AKIA`, etc. as a warning surface in SKILL.md, not a redactor** | Cheap. Signals to the assistant "this corpus is hot, don't paste it into a network tool." | Regex false positives. Could lull the user into thinking absence of a match means safe. |

### Identity drift

Project paths can collide or differ across machines:

- Same project name, different absolute path: `/Users/ben/src/foo` on personal, `/Users/bdrucker/work/foo` on work. These should be queryable as the same logical project, but distinct host-scoped paths.
- Same path, different project: `/Users/ben/src/scratch` on both machines, with completely different contents.
- Session IDs are UUIDs and so should not collide in practice, but the index assumes session-id is unique. With multi-host, we should key on `(host, session_id)`.

| Option | Pros | Cons |
|---|---|---|
| **D1. Compound key `(host, session_id)` on all views that previously assumed unique `session_id`** | Correct. Eliminates collision risk by construction. | Touches every aggregation. `GROUP BY session_id` becomes `GROUP BY host, session_id`. |
| **D2. Trust that UUIDs don't collide; just add `host` for filtering** | Less churn. UUID collision probability is genuinely negligible. | Doesn't address path-based identity (same path, different repo). |
| **D3. Add a derived `project_id := host || ':' || project_path` for cases where you want a stable project identity across machines** | Useful for projects checked out on both machines with different paths. | Convention only; analyses have to opt in. |

### Privacy framing

Importing work-machine sessions to a personal machine has implications: employer data ownership, retention policies, what's appropriate to load into an LLM's context. The design should raise this for the user to decide per-import, not silently enable it.

| Option | Pros | Cons |
|---|---|---|
| **P1. SKILL.md surfaces a "before you import work data" warning that the assistant must repeat to the user** | Forces the conversation each time. Doesn't pretend the tool can decide for the user. | Friction. The user may dismiss it reflexively. |
| **P2. `session import` prompts interactively when `--host` matches a configured "sensitive" label** | Affirmative consent per import. | Interactive prompts are awkward inside a Claude session; the assistant has to surface the question. |
| **P3. Configurable `.claude/session-imports.json` with per-host policies (e.g., `{ "work": { "warn": true, "expire": "7d" } }`)** | Codifies intent. Cheap to add. | More configuration. The user has to set it up before it helps. |

## Recommended approach

The recommended stack picks the simplest viable option per axis and is intentionally boring:

- **Acquisition: A5** (`session import <local-dir> --host <label>`). The plugin does not own SSH. Document the recommended `rsync` invocation in SKILL.md, but let the user pick their own transport. A second pass can add A2 if A5 turns out to be too tedious.
- **Storage: S1** with a twist: `~/.claude/session-imports/<host>/projects/...`, mode `0700` / `0600`, but with a top-level `~/.claude/session-imports/<host>/manifest.json` recording `host`, `imported_at`, `source` (e.g., `bvdrucker@work.local:~/.claude/projects/`), and `policy` (e.g., `{ "warn_on_query": true }`).
- **Indexing: I1**. Add a pinned `host` column to `raw`. Local sessions get `host = 'local'`. Imported sessions get `host = <label>`. The existing `getProjectsGlob` becomes a list of (host, glob) pairs, derived from the import directory.
- **Skill surface: K2**. New scripts: `import.ts`, `forget.ts`, `hosts.ts`. Existing `query.ts` is unchanged except that named queries gain an optional `host=` param via a new `host_filter` macro.
- **Scrub: C1 + C4**. `forget` deletes files and rows. Credential sniff is a warning surface in SKILL.md only (not a redactor, since a redactor that's wrong is worse than no redactor).
- **Identity: D1 + D3**. Use `(host, session_id)` everywhere. Add the `project_id` convention for analyses that want cross-host project identity.
- **Privacy: P1 + P3**. SKILL.md raises the framing once. `manifest.json` per host records the user's stated intent so the assistant can act on it consistently (e.g., refuse to include `host = 'work'` content in a draft going to a public destination).

### Rationale

I1 plus A5 plus K2 is the smallest change that meets every constraint:

- One DB keeps every existing query working unchanged (no `ATTACH` ceremony, no schema-drift class of bugs).
- A5 keeps the plugin out of the SSH business, which is the largest source of "this doesn't work on my machine" pain.
- K2 keeps `query.ts` focused on querying. Lifecycle operations (import, forget) belong in dedicated scripts that can be tested without spinning up DuckDB.
- The `host` column is a small, stable schema change. The migration is the same shape as the existing `migrateIfNeeded` (drop and re-import on missing column).

### Rejected approaches and why

- **SSHFS (A4)**: violates "network access is slow." `read_json_objects` over SSHFS would re-fetch on every refresh.
- **Restic/borg (A3)**: too much infrastructure for two machines. The user already has `rsync`. If we ever support N>5 machines or want immutable history, revisit.
- **Per-host DB (I2)**: cross-DB queries are a footgun. Schema drift between attached DBs would silently change results between sessions.
- **Path-derived host (I3)**: brittle and unfriendly. The user types `host=work`, not `host=/Users/ben/.claude/session-imports/work/projects`.
- **Auto-scrub Stop hook (C2)**: too dangerous, and incompatible with cross-session analyses. A user-invoked `forget` is enough.
- **Bundled credential redactor**: a partial regex redactor is worse than no redactor because it implies safety. Warning only.

## Migration sketch

Schema change to `resources/schema/01_tables.sql`:

```sql
CREATE TABLE IF NOT EXISTS raw (
  host            VARCHAR,          -- new
  session_id      VARCHAR,
  type            VARCHAR,
  project_path    VARCHAR,
  -- ...unchanged columns...
  source_file     VARCHAR,
  source_line     BIGINT,
  data            JSON
);

CREATE TABLE IF NOT EXISTS host_registry (
  host            VARCHAR PRIMARY KEY,
  projects_glob   VARCHAR NOT NULL,
  imported_at     TIMESTAMP,
  source          VARCHAR,
  policy          JSON
);
```

`migrateIfNeeded` in `db.ts` gains a second check:

```ts
const [hostCol] = await db.query<{ ok: boolean }>(`
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'main' AND table_name = 'raw' AND column_name = 'host'
  ) AS ok
`);
if (!hostCol?.ok) {
  await db.run("DROP TABLE IF EXISTS messages");
  await db.run("DROP TABLE IF EXISTS content_items");
  await db.run("DROP TABLE IF EXISTS raw");
  await db.run("DROP TABLE IF EXISTS meta");
}
```

`refresh.sql` becomes per-host. Pseudocode for the loop in `db.ts`:

```ts
const hosts = await db.query<{ host: string; projects_glob: string }>(
  "SELECT host, projects_glob FROM host_registry",
);

for (const { host, projects_glob } of hosts) {
  await db.run("SET VARIABLE host = $host", { host });
  await db.run("SET VARIABLE projects_glob = $glob", { glob: projects_glob });
  await db.run(await readSql(RESOURCES_DIR, "refresh"));

  const [{ n }] = await db.query<{ n: bigint }>(
    "SELECT LEN(getvariable('changed_files')) AS n",
  );
  if (n === 0n) continue;

  await db.run("SET VARIABLE source = getvariable('changed_files')");
  await db.run(await readSql(RESOURCES_DIR, "import"));
}

await db.run(await readSql(RESOURCES_DIR, "views"));
```

`import.sql` adds `getvariable('host') AS host` to the projected columns and the `UNION ALL` keeps working because the pinned schema includes `host`.

New macro in `resources/schema/03_macros.sql`:

```sql
CREATE OR REPLACE MACRO host_filter(host_col, host_val) AS
  (host_val IS NULL OR host_col = host_val::VARCHAR);
```

Existing queries gain a single `AND host_filter(host, getvariable('host'))` clause, gated on a new optional `host=` param (just like `after_date` / `project`).

`host_registry` bootstrap: on first `ensureIndex` after migration, insert a row for `local` pointing at `~/.claude/projects/**/*.jsonl`. `session import` and `session forget` mutate `host_registry`.

## SKILL.md additions

Sketched here rather than edited inline. Drop into `SKILL.md` after `## Session File Structure`.

```markdown
## Cross-Machine History

You can query session history from more than one machine. Imported hosts are
read-only mirrors of another machine's `~/.claude/projects/`, stored locally at
`~/.claude/session-imports/<host>/projects/`.

### Listing hosts

`${CLAUDE_SKILL_DIR}/scripts/hosts.ts`

Returns one row per host (`local` plus any imported), with `imported_at`,
`source`, and `policy`.

### Importing

The plugin does not fetch over the network. The user runs (or asks you to run)
something like:

`rsync -av --update <user@host>:~/.claude/projects/ ~/.claude/session-imports/<label>/projects/`

Then register the import:

`${CLAUDE_SKILL_DIR}/scripts/import.ts --host <label> --source <user@host>:~/.claude/projects/`

Imports default to mode `0700` on directories and `0600` on files.

### Querying

All named queries accept an optional `host=` param. Omit it to query every host.

`${CLAUDE_SKILL_DIR}/scripts/query.ts search query=authentication host=work`

`${CLAUDE_SKILL_DIR}/scripts/query.ts stats host=local after_date=2026-05-01`

### Forgetting

`${CLAUDE_SKILL_DIR}/scripts/forget.ts --host <label>`

Removes the imported directory and deletes rows from the index. Local sessions
cannot be forgotten this way.

### Privacy

Importing work-machine sessions to a personal machine (or vice versa) has
implications: employer data ownership, retention policies, customer data, what
is appropriate to load into an LLM's context. Before importing, raise this with
the user explicitly. Record the user's choice in the per-host `policy` field
(e.g., `{ "warn_on_query": true, "block_egress": true }`).

When a host has `block_egress: true` in its policy, do not include rows from
that host in any output that leaves this machine (PR descriptions, Slack
messages, email drafts, web requests, file uploads). Filter with
`WHERE host != '<label>'` or `WHERE host IN ('local')`.

### Credential warning

Session content can include secrets (API keys, tokens, passwords) that the user
or the assistant pasted into a prompt. If you grep imported content for things
matching `sk_live_`, `xoxb-`, `ghp_`, `AKIA`, `eyJhbGciOi`, treat any matches as
a signal that this corpus is hot: do not paste it back into shell output, do
not include it in messages, and warn the user.
```

## Draft `import.ts` (cleye-based)

Sketch only. Not wired up.

```ts
#!/usr/bin/env bun
import { chmodSync, mkdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { cli } from "cleye";
import { getDb, ensureIndex } from "./db";

const argv = cli({
  name: "import",
  flags: {
    host: {
      type: String,
      description: "Label for this host (e.g., 'work')",
    },
    source: {
      type: String,
      description: "Human-readable origin (e.g., 'user@work:~/.claude/projects/')",
      default: "",
    },
    dir: {
      type: String,
      description: "Local directory containing the host's projects/. Defaults to ~/.claude/session-imports/<host>/projects/",
      default: "",
    },
    policy: {
      type: String,
      description: "JSON policy string (e.g., '{\"warn_on_query\":true}')",
      default: "{}",
    },
  },
});

if (!argv.flags.host) {
  console.error("--host is required");
  process.exit(1);
}
if (argv.flags.host === "local") {
  console.error("'local' is reserved for the current machine's ~/.claude/projects/");
  process.exit(1);
}

const home = process.env.HOME;
if (!home) {
  console.error("HOME is not set");
  process.exit(1);
}

const importRoot = path.join(home, ".claude", "session-imports", argv.flags.host);
const projectsDir = argv.flags.dir || path.join(importRoot, "projects");

mkdirSync(importRoot, { recursive: true, mode: 0o700 });

try {
  const stat = statSync(projectsDir);
  if (!stat.isDirectory()) {
    console.error(`${projectsDir} is not a directory`);
    process.exit(1);
  }
  chmodSync(importRoot, 0o700);
} catch (err) {
  console.error(`Cannot read ${projectsDir}:`, err);
  console.error("Did you rsync the host's ~/.claude/projects/ into that directory first?");
  process.exit(1);
}

const dataDir =
  process.env.CLAUDE_PLUGIN_DATA || path.join(process.env.TMPDIR || "/tmp", "claude-session");
mkdirSync(dataDir, { recursive: true });

const db = await getDb(dataDir);
try {
  await ensureIndex(db, { dataDir }); // ensure schema/host_registry exist
  await db.run(
    `INSERT OR REPLACE INTO host_registry (host, projects_glob, imported_at, source, policy)
     VALUES ($host, $glob, CURRENT_TIMESTAMP, $source, CAST($policy AS JSON))`,
    {
      host: argv.flags.host,
      glob: path.join(projectsDir, "**", "*.jsonl"),
      source: argv.flags.source,
      policy: argv.flags.policy,
    },
  );
  // Trigger a refresh that includes the new host
  await ensureIndex(db, { dataDir, force: true });
} finally {
  db.close();
}

console.log(`Imported host '${argv.flags.host}' from ${projectsDir}`);
```

## Open questions for the refinement session

1. **Naming.** Is `host` the right column name? Alternatives: `origin`, `source_host`, `machine`. `host` is short and reads well in `WHERE host = 'work'`, but in queries that already use `source_file` it might be confusable.
2. **Local refresh semantics.** Today the refresh marker is keyed on `CLAUDE_SESSION_ID`. With multiple hosts, does the marker still mean "all hosts refreshed"? Or do we want per-host markers so that `session import work` does not invalidate the warm marker for `local`?
3. **`forget` and warm markers.** When a host is forgotten, do we drop the warm marker so the next session does a full re-import for the remaining hosts? Or just delete rows for the forgotten host and leave the marker?
4. **Privacy framing intensity.** Is a one-time SKILL.md note enough, or do we want the assistant to surface a per-import confirmation each time it sees an unfamiliar host appear in query results? The latter is more annoying but more honest.
5. **Path-derived projects.** Should `project_id := host || ':' || project_path` be a generated column on `raw` or a convention queries opt into? Generated columns simplify joins but bloat storage.
6. **Coexistence with the trope-analysis branch.** If `text_content` lands first and is a view over `messages`, it inherits `host` for free. If it is a materialized table, it needs a one-line schema bump. Verify this when both branches are ready to merge.
7. **Time skew.** Different machines may have different clocks. Are aggregations like "messages per day" safe to do across hosts, or do we need a per-host timezone normalization?
8. **`session sync` (A2) as a future addition.** Worth speccing now, or wait until A5 proves painful?
