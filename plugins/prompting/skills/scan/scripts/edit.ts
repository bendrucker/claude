#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: an audit edits project skills, and the sandbox denies writes under .claude/skills
import { realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { Command } from "@commander-js/extra-typings";
import {
  Applied,
  applyProposals,
  Checked,
  emit,
  Proposal,
  readJsonl,
  readOptionalJsonl,
  Rejection,
  repoName,
  revertEdits,
  runOf,
  siblings,
  toplevel,
  type Unverified,
  writeJsonl,
} from "./audit";
import { AGENT_FACING } from "./scan";

/**
 * Throws unless every file is an agent-facing document inside the repository, since this
 * script writes outside the sandbox.
 */
export async function assertTargets(root: string, files: Iterable<string>): Promise<void> {
  const top = await realpath(root);
  const glob = new Bun.Glob(AGENT_FACING);
  const resolved = await Promise.all(
    [...new Set(files)].map(async (file) => {
      const path = resolve(top, file);
      const target = path.startsWith(`${top}/`) ? await realpath(path).catch(() => path) : path;
      return { file, target };
    }),
  );
  const allowed = ({ target }: { target: string }): boolean =>
    target.startsWith(`${top}/`) && glob.match(relative(top, target));
  const refused = resolved.filter((row) => !allowed(row)).map((row) => row.file);
  if (refused.length > 0) {
    throw new Error(
      `refusing files that are not agent-facing documents in ${top}: ${refused.join(", ")}`,
    );
  }
}

/** Splits the ledger by its `checks.jsonl` outcomes, throwing on a check that never ran. */
export function partition(
  proposals: readonly Proposal[],
  checked: readonly Checked[],
): { verified: Proposal[]; unverified: Unverified[] } {
  const outcomes = new Map(checked.map((row) => [row.id, row.why]));
  const unchecked = proposals.filter((p) => p.check !== undefined && !outcomes.has(p.id));
  if (unchecked.length > 0) {
    throw new Error(
      `run audit.ts check first, these checks have no outcome: ${unchecked.map((p) => p.id).join(", ")}`,
    );
  }
  const verified: Proposal[] = [];
  const unverified: Unverified[] = [];
  for (const proposal of proposals) {
    const why = outcomes.get(proposal.id) ?? null;
    if (why === null) verified.push(proposal);
    else unverified.push({ id: proposal.id, file: proposal.file, why });
  }
  return { verified, unverified };
}

const applyCommand = new Command("apply")
  .description("Apply each checked proposal in the ledger to the working tree.")
  .argument("<ledger>", "proposals.jsonl")
  .action(async (ledger) => {
    const paths = siblings(ledger);
    if (await Bun.file(paths.applied).exists()) {
      throw new Error(`${paths.applied} exists: this ledger was already applied.`);
    }
    const root = await toplevel(process.cwd());
    const proposals = await readJsonl(ledger, Proposal);
    const checked = await readOptionalJsonl(paths.checks, Checked);
    const { verified, unverified } = partition(proposals, checked);
    await assertTargets(
      root,
      verified.map((proposal) => proposal.file),
    );
    const { applied, unlocated } = await applyProposals(root, verified);
    await writeJsonl(paths.applied, applied);
    const repo = await repoName(root);
    const run = runOf(ledger);
    await emit(
      applied.map((row) => ({
        event: "proposal",
        detail: { run, id: row.id, class: row.class, file: row.file, repo },
      })),
    );
    console.log(`applied ${applied.length} of ${proposals.length} proposals`);
    for (const miss of unlocated) {
      console.log(`unlocated: ${miss.id} (${miss.file}): ${miss.why}`);
    }
    for (const miss of unverified) {
      console.log(`unverified: ${miss.id} (${miss.file}): ${miss.why}`);
    }
  });

const revertCommand = new Command("revert")
  .description("Restore rejected proposals and record why.")
  .argument("<ledger>", "proposals.jsonl")
  .argument("<id...>", "proposals to restore")
  .option("--reason <text>", "why the reviewer rejected them, applied to every id given", "")
  .action(async (ledger, ids, options) => {
    const paths = siblings(ledger);
    const root = await toplevel(process.cwd());
    const applied = await readJsonl(paths.applied, Applied);
    const prior = await readOptionalJsonl(paths.rejections, Rejection);
    const done = new Set(prior.filter((row) => row.reverted).map((row) => row.id));
    for (const skipped of ids.filter((candidate) => done.has(candidate))) {
      console.log(`already reverted: ${skipped}`);
    }

    const pending = ids.filter((candidate) => !done.has(candidate));
    await assertTargets(
      root,
      applied.filter((row) => pending.includes(row.id)).map((row) => row.file),
    );
    const result = await revertEdits(root, applied, pending);
    const known = new Set(applied.map((row) => row.id));
    const merged = new Map(prior.map((row) => [row.id, row]));
    for (const rejected of pending.filter((candidate) => known.has(candidate))) {
      merged.set(rejected, {
        id: rejected,
        reason: options.reason,
        reverted: result.reverted.includes(rejected),
      });
    }
    await writeJsonl(paths.rejections, [...merged.values()]);
    for (const id of result.reverted) console.log(`reverted: ${id}`);
    for (const miss of result.failed) console.log(`failed: ${miss.id}: ${miss.why}`);
    if (result.failed.length > 0) process.exitCode = 1;
  });

export const program = new Command("edit")
  .description("Write an audit round to the working tree: apply proposals, revert rejections.")
  .addCommand(applyCommand)
  .addCommand(revertCommand);

if (import.meta.main) {
  await program.parseAsync();
}
