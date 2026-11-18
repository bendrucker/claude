---
name: prompting:audit
description: "Run one prune round over documents a model executes: a judge proposes cuts of lines a current model no longer needs, the user reviews them, and the verdicts become telemetry and precision labels. Use when asked to audit, prune, or trim a repository's skills, CLAUDE.md, rules, or agent definitions by reading them."
argument-hint: "[<path>...]"
allowed-tools:
  - Bash(bun ${CLAUDE_SKILL_DIR}/scripts/audit.ts:*)
  - Bash(prompt-scan-edit:*)
  - Bash(sh ${CLAUDE_PLUGIN_ROOT}/scripts/bin-path-check.sh:*)
  - Read
  - Edit
---

# Audit

Run one round of the prune loop over the paths in `$ARGUMENTS`, defaulting to the current directory. A judge reads each document and proposes cuts of lines a current model no longer needs, the user accepts or rejects each in review, and the verdicts become telemetry and rule-precision labels. The round is done when every ledger proposal has a verdict event and the per-class table is printed.

List the units:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/audit.ts units [<path>...]
```

Where the `observability:session` index is available, rank the units by its `memory-loads` query, which multiplies each rule or nested `CLAUDE.md`'s load count by its injected size, and judge the costliest first.

Judge one unit inline. Judge more than one through a Workflow with one judge per batch of units, kept within the session's workflow size, since this skill's instruction to run one is the opt-in. [references/judge.md](references/judge.md) holds the judge prompt and output schema, and [references/classes.md](references/classes.md) the classes it tags. Write the returned proposals to `tmp/prompting-audit/<run>/proposals.jsonl` in the audited repo, one per line with a unique `id`, where `<run>` names the round.

!`sh ${CLAUDE_PLUGIN_ROOT}/scripts/bin-path-check.sh prompt-scan-edit`

Then drive the ledger through `audit.ts` and `prompt-scan-edit`:

- `audit.ts check <ledger>` runs each `enforced` proposal's planted-violation check and lists any that did not hold.
- `prompt-scan-edit apply <ledger>` applies every proposal whose check held to the working tree and lists any quote it could not locate. A failed check or a missing quote drops the proposal out of the round.
- The user reviews the diff. Where `plannotator` is available, open it with `plannotator review`, which opens a browser and runs outside the sandbox, and read an annotation on a hunk as a rejection of that proposal. Otherwise ask the user to name the rejected hunks.
- `prompt-scan-edit revert <ledger> <id...> --reason <annotation>` restores each rejected span.
- Commit the round with nothing else in the commit, and open it as its own pull request, so rule-precision can read its squash commit as labels.
- `audit.ts verdict <ledger> --commit <sha>` reconciles each proposal against the commit, so a hand edit the user makes before committing counts too. It prints the per-class table and the precision-label entry.

## Gotchas

- The ledger copies source text, so it stays untracked under `tmp/`.
- The sandbox denies writes under `.claude/skills`. An `excludedCommands` entry `prompt-scan-edit:*` lets the bare command escape, and the plugin README covers the setup. Run `prompt-scan-edit` as the whole Bash command. Without the entry, a sandboxed run fails with nothing written, and this skill authorizes rerunning it with `dangerouslyDisableSandbox: true`. It writes only agent-facing files inside the repository.
- Retire this skill when two consecutive rounds fall below 50% overall acceptance in the `prune-acceptance` session query. [references/classes.md](references/classes.md) holds the per-class retirement rule.
