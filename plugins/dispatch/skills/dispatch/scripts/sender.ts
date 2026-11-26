import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { type Runner, spawnRunner } from "./runner";

export interface SenderMux {
  kind: "rex" | "herdr";
  // The Rex block or herdr pane running the dispatching session.
  id: string;
  // How another machine names this one: a Rex server address `rex -S` takes,
  // or the hostname a herdr machine label stands for.
  machine: string | null;
}

export interface Sender {
  name: string;
  mux: SenderMux | null;
}

const SessionEntry = z.object({ name: z.string().min(1) });

const RexWhoami = z.object({
  tailscale: z.object({ state: z.string(), dns_name: z.string().nullish() }).nullish(),
});

function claudeConfigDir(env: Readonly<Record<string, string | undefined>>): string {
  const dir = env.CLAUDE_CONFIG_DIR;
  return dir != null && dir !== "" ? dir : join(homedir(), ".claude");
}

// Claude Code registers each live session under its pid with the name that
// ListAgents and SendMessage address it by.
export async function readSender(
  env: Readonly<Record<string, string | undefined>>,
  run: Runner = spawnRunner,
  host: string = hostname(),
): Promise<Sender | null> {
  const entry = await readSessionEntry(env, SessionEntry);
  if (entry == null) return null;
  return { name: entry.name, mux: await senderMux(env, run, host) };
}

const LiveSession = z.object({ sessionId: z.string().min(1) });

// After a plan's "clear context", CLAUDE_SESSION_ID still names the planning
// session while this entry stores the id of the transcript being written.
export async function readLiveSession(
  env: Readonly<Record<string, string | undefined>>,
): Promise<string | null> {
  return (await readSessionEntry(env, LiveSession))?.sessionId ?? null;
}

async function readSessionEntry<T>(
  env: Readonly<Record<string, string | undefined>>,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const pid = env.CLAUDE_PID;
  if (pid == null || !/^\d+$/.test(pid)) return null;
  const file = Bun.file(join(claudeConfigDir(env), "sessions", `${pid}.json`));
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    // A missing or unreadable entry means the caller falls back to what it was given.
    return null;
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

async function senderMux(
  env: Readonly<Record<string, string | undefined>>,
  run: Runner,
  host: string,
): Promise<SenderMux | null> {
  const rex = env.REX_BLOCK;
  if (rex != null && rex !== "") return { kind: "rex", id: rex, machine: await rexAddress(run) };
  const herdr = env.HERDR_PANE_ID;
  if (herdr != null && herdr !== "")
    return { kind: "herdr", id: herdr, machine: host === "" ? null : host };
  return null;
}

// The local endpoint is a unix socket, so only the server's tailnet name
// reaches it from another machine.
async function rexAddress(run: Runner): Promise<string | null> {
  const result = await run(["rex", "whoami", "--json"]);
  if (result.code !== 0) return null;
  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    // An older Rex without `--json` leaves the footer machine-local.
    return null;
  }
  const parsed = RexWhoami.safeParse(json);
  const tailscale = parsed.success ? parsed.data.tailscale : null;
  if (tailscale?.state !== "running") return null;
  return tailscale.dns_name ?? null;
}

function remoteHint(mux: SenderMux): string {
  if (mux.machine == null) return "";
  if (mux.kind === "rex")
    return ` From another machine, pass \`-S ${mux.machine}\` to \`rex\` to address that block.`;
  return ` From another machine, pass \`--machine\` with the \`herdr machine list\` label for \`${mux.machine}\` to address that pane.`;
}

const CLOSE_WHEN_OPEN = "Once the PR is open, run `dispatch:close`.";

export function withSender(prompt: string, sender: Sender | null, close: boolean): string {
  const lines: string[] = [];
  if (sender != null) {
    const { mux } = sender;
    const where =
      mux == null
        ? ""
        : ` in ${mux.kind === "rex" ? "Rex block" : "herdr pane"} \`${mux.id}\`${mux.machine == null ? "" : ` on \`${mux.machine}\``}`;
    const hint = mux == null ? "" : remoteHint(mux);
    lines.push(
      `The Claude session \`${sender.name}\`${where} dispatched this task. Reach it with \`SendMessage\` to \`${sender.name}\`.${hint}`,
    );
  }
  if (close) lines.push(CLOSE_WHEN_OPEN);
  if (lines.length === 0) return prompt;
  return `${prompt.trimEnd()}\n\n---\n\n${lines.join("\n\n")}\n`;
}
