#!/usr/bin/env bun
// Compact orientation view over `rex session inspect`, for bang-execution in
// SKILL.md. Every failure degrades to one line rather than leaking a socket
// error or a stack trace into the skill body.
import { z } from "zod";

const REX_TIMEOUT_MS = 5_000;

const Block = z.object({
  block_id: z.string(),
  label: z.string().nullish(),
});
type Block = z.infer<typeof Block>;

const Window = z.object({
  window_id: z.string(),
  label: z.string().nullish(),
  focused_block_id: z.string().nullish(),
  layers: z.array(z.object({ blocks: z.array(Block).nullish() })).nullish(),
});
type Window = z.infer<typeof Window>;

const Inspect = z.object({
  label: z.string().nullish(),
  active_window_id: z.string().nullish(),
  windows: z.array(Window).nullish(),
});
type Inspect = z.infer<typeof Inspect>;

const Process = z.object({
  foreground: z
    .object({
      name: z.string().nullish(),
      argv0: z.string().nullish(),
      cwd: z.string().nullish(),
    })
    .nullish(),
});
type Process = z.infer<typeof Process>;

// Only `label` is read. Endpoints can contain an SSH hostname and stay out of
// the projection.
const Hosts = z.object({
  hosts: z.array(z.object({ label: z.string().nullish() })).nullish(),
});

function decode<T>(schema: z.ZodType<T>, text: string): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return null;
  }
}

// rex's errors can include a server address, and this output is prompt text, so
// stderr is discarded and a failure comes back as null.
async function rex(args: string[]): Promise<string | null> {
  let proc;
  try {
    proc = Bun.spawn(["rex", ...args], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    return null;
  }
  const timer = setTimeout(() => {
    proc.kill();
  }, REX_TIMEOUT_MS);
  try {
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return code === 0 ? stdout : null;
  } finally {
    clearTimeout(timer);
  }
}

function blocksOf(window: Window): Block[] {
  return (window.layers ?? []).flatMap((layer) => layer.blocks ?? []);
}

// A login shell's argv0 is `-zsh`, and a versioned binary's name is its
// version, so argv0 names the program better.
export function programName(process: Process | undefined): string {
  const foreground = process?.foreground;
  const name = foreground?.argv0 ?? foreground?.name ?? "";
  return name.replace(/^-/, "");
}

export function orientation(
  inspect: Inspect,
  processes: Map<string, Process>,
  thisBlock: string,
): string {
  const lines = [
    `session "${inspect.label ?? ""}"   this block: ${thisBlock === "" ? "unknown" : thisBlock}`,
  ];
  for (const [index, window] of (inspect.windows ?? []).entries()) {
    const active = window.window_id === inspect.active_window_id ? "  *active*" : "";
    lines.push(`tab ${index + 1}  ${window.window_id}  "${window.label ?? ""}"${active}`);
    for (const block of blocksOf(window)) {
      const process = processes.get(block.block_id);
      const program = programName(process);
      const cwd = process?.foreground?.cwd ?? "";
      const columns = [
        block.block_id === window.focused_block_id ? "  *focused*" : "",
        block.block_id === thisBlock ? "  *this*" : "",
        `  "${block.label ?? ""}"`,
        cwd === "" ? "" : `  ${cwd}`,
        program === "" ? "" : `  ${program}`,
      ].join("");
      lines.push(`  ${block.block_id}${columns}`);
    }
  }
  return lines.join("\n");
}

export function hostsLine(listing: string | null): string | null {
  if (listing === null) return null;
  const hosts = decode(Hosts, listing);
  const labels = (hosts?.hosts ?? [])
    .map((host) => host.label)
    .filter((label): label is string => label != null && label !== "");
  if (labels.length === 0) return null;
  return `hosts saved (reach unverified, pass -S <label>): ${labels.join(", ")}`;
}

async function processOf(session: string, block: string): Promise<Process | null> {
  const text = await rex(["block", "call", "-s", session, "-b", block, "process"]);
  return text === null ? null : decode(Process, text);
}

async function orient(): Promise<void> {
  const session = process.env.REX_SESSION ?? "";
  if (session === "") {
    console.log(
      "Not running under Rex (REX_SESSION unset). The commands below will not reach a server.",
    );
    return;
  }

  if (Bun.which("rex") === null) {
    console.log("rex is not on PATH.");
    return;
  }

  const [inspectText, listing] = await Promise.all([
    rex(["session", "inspect", session, "--json"]),
    rex(["hosts", "list", "--json"]),
  ]);

  if (inspectText === null) {
    console.log(
      'rex session inspect failed. Run it directly to see why: rex session inspect "$REX_SESSION" --json',
    );
    return;
  }

  const inspect = decode(Inspect, inspectText);
  if (inspect === null) {
    console.log(
      'Session did not match the expected shape. Read it directly with: rex session inspect "$REX_SESSION" --json',
    );
    return;
  }

  const blockIds = (inspect.windows ?? []).flatMap(blocksOf).map((block) => block.block_id);
  const results = await Promise.all(blockIds.map((id) => processOf(session, id)));
  const processes = new Map<string, Process>();
  for (const [index, id] of blockIds.entries()) {
    const result = results[index];
    if (result != null) processes.set(id, result);
  }

  console.log(orientation(inspect, processes, process.env.REX_BLOCK ?? ""));
  const hosts = hostsLine(listing);
  if (hosts !== null) console.log(hosts);
}

if (import.meta.main) {
  try {
    await orient();
  } catch (error) {
    console.log(`Orientation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
