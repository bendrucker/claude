#!/usr/bin/env bun
// Compact orientation view over `herdr api snapshot`, for bang-execution in
// SKILL.md. Every failure degrades to one line rather than leaking a socket
// error or a stack trace into the skill body.
import { z } from "zod";

const HERDR_TIMEOUT_MS = 5_000;

// herdr appends the agent session to a terminal title.
const SESSION_SUFFIX = / · [0-9a-f-]+$/;

const Workspace = z.object({
  workspace_id: z.string(),
  label: z.string().nullish(),
  focused: z.boolean().nullish(),
  worktree: z
    .object({
      checkout_path: z.string().nullish(),
      repo_name: z.string().nullish(),
      is_linked_worktree: z.boolean().nullish(),
    })
    .nullish(),
});
type Workspace = z.infer<typeof Workspace>;

const Pane = z.object({
  pane_id: z.string(),
  workspace_id: z.string(),
  agent: z.string().nullish(),
  agent_status: z.string().nullish(),
  agent_session: z.object({ value: z.string().nullish() }).nullish(),
  cwd: z.string().nullish(),
  foreground_cwd: z.string().nullish(),
  terminal_title_stripped: z.string().nullish(),
});
type Pane = z.infer<typeof Pane>;

const Snapshot = z.object({
  version: z.string().nullish(),
  protocol: z.union([z.string(), z.number()]).nullish(),
  workspaces: z.array(Workspace).nullish(),
  panes: z.array(Pane).nullish(),
});
type Snapshot = z.infer<typeof Snapshot>;

const SnapshotEnvelope = z.object({ result: z.object({ snapshot: Snapshot }) });

// Only `label` and `enabled` are read. `target` carries an SSH hostname and
// stays out of the projection.
const Machines = z.array(z.object({ label: z.string().nullish(), enabled: z.boolean().nullish() }));

function decode<T>(schema: z.ZodType<T>, text: string): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return null;
  }
}

// herdr's errors can name an SSH target, and this output is prompt text, so
// stderr is discarded and a failure comes back as null rather than the message
// it printed.
async function herdr(args: string[]): Promise<string | null> {
  let proc;
  try {
    proc = Bun.spawn(["herdr", ...args], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  } catch {
    // A spawn can throw when the binary is missing or the process table is
    // exhausted, which leaves the same nothing to report as a non-zero exit.
    return null;
  }
  const timer = setTimeout(() => {
    proc.kill();
  }, HERDR_TIMEOUT_MS);
  try {
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return code === 0 ? stdout : null;
  } finally {
    clearTimeout(timer);
  }
}

function workspaceLine(workspace: Workspace): string {
  const focused = workspace.focused === true ? "  *focused*" : "";
  const tree = workspace.worktree;
  // The skill body reads `primary` to rule a workspace out as a hand-off target.
  const kind = tree?.is_linked_worktree === true ? "worktree" : "primary";
  const repo =
    tree == null ? "" : `  [${tree.repo_name ?? "?"} ${kind}] ${tree.checkout_path ?? ""}`;
  return `${workspace.workspace_id}  ${workspace.label ?? ""}${focused}${repo}`;
}

function paneLine(pane: Pane, root: string): string {
  const cwd = pane.foreground_cwd ?? pane.cwd ?? "";
  const session = pane.agent_session?.value ?? "";
  const title = (pane.terminal_title_stripped ?? "").replace(SESSION_SUFFIX, "");
  // A title that is just the cwd, tilde-abbreviated, repeats the column beside it.
  const expanded = title.startsWith("~") ? `${process.env.HOME ?? ""}${title.slice(1)}` : title;
  const columns = [
    session === "" ? "" : `  ${session}`,
    cwd !== "" && cwd !== root ? `  ${cwd}` : "",
    title !== "" && expanded !== cwd ? `  "${title}"` : "",
  ].join("");
  return `    ${pane.pane_id}  ${pane.agent ?? "shell"}/${pane.agent_status ?? "?"}${columns}`;
}

function orientation(snapshot: Snapshot): string {
  const panes = snapshot.panes ?? [];
  const lines = [
    `herdr ${snapshot.version ?? "?"}  protocol ${snapshot.protocol ?? "?"}   this pane: ${process.env.HERDR_PANE_ID ?? "unknown"}`,
    "",
  ];
  for (const workspace of snapshot.workspaces ?? []) {
    lines.push(workspaceLine(workspace));
    const root = workspace.worktree?.checkout_path ?? "";
    for (const pane of panes) {
      if (pane.workspace_id === workspace.workspace_id) lines.push(paneLine(pane, root));
    }
  }
  return lines.join("\n");
}

function machinesLine(listing: string | null): string | null {
  if (listing === null) return null;
  const machines = decode(Machines, listing);
  if (machines === null) return null;
  const labels = machines
    .filter((machine) => machine.enabled === true)
    .map((machine) => machine.label)
    .filter((label) => label != null && label !== "");
  if (labels.length === 0) return null;
  return `machines saved (reach unverified, prefix with --machine <label>): ${labels.join(", ")}`;
}

async function orient(): Promise<void> {
  if ((process.env.HERDR_PANE_ID ?? "") === "") {
    console.log(
      "Not running under herdr (HERDR_PANE_ID unset). The commands below will not reach a server.",
    );
    return;
  }

  if (Bun.which("herdr") === null) {
    console.log("herdr is not on PATH.");
    return;
  }

  // The machine listing reads local config, so it answers without probing a
  // sleeping machine. Both calls are independent, and running them together
  // keeps a stalled one from adding its timeout to the other's in a block that
  // resolves before the model's first turn.
  const [snapshot, listing] = await Promise.all([
    herdr(["api", "snapshot"]),
    herdr(["machine", "list", "--json"]),
  ]);

  if (snapshot === null) {
    console.log("herdr api snapshot failed. Run it directly to see why: herdr api snapshot");
    return;
  }

  const parsed = decode(SnapshotEnvelope, snapshot);
  console.log(
    parsed === null
      ? "Snapshot did not match the expected shape. Read it directly with: herdr api snapshot | jq ."
      : orientation(parsed.result.snapshot),
  );

  const machines = machinesLine(listing);
  if (machines !== null) console.log(machines);
}

if (import.meta.main) {
  try {
    await orient();
  } catch (error) {
    console.log(`Orientation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
