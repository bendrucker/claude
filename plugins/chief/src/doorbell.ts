import { z } from "zod";

// herdr answers with { id, result } on success and { id, error: { code } } on refusal.
const HerdrEnvelope = z.looseObject({ error: z.looseObject({ code: z.string() }).optional() });
export interface SpawnResult {
  status: string;
}

export function parseSpawnOutput(output: string): SpawnResult {
  const envelope = HerdrEnvelope.parse(JSON.parse(output));
  return { status: envelope.error?.code ?? "ok" };
}

export type Spawn = (agent: string, text: string) => Promise<SpawnResult>;
export type Sleep = (ms: number) => Promise<void>;
export type Status = (agent: string) => Promise<string>;

const HerdrAgentGet = z.looseObject({
  result: z
    .looseObject({ agent: z.looseObject({ agent_status: z.string().optional() }) })
    .optional(),
});

// "unknown" when herdr has no agent by that name or the output is not its envelope.
export function parseAgentStatus(output: string): string {
  try {
    return HerdrAgentGet.parse(JSON.parse(output)).result?.agent.agent_status ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function herdrStatus(agent: string): Promise<string> {
  const proc = Bun.spawn(["herdr", "agent", "get", agent], { stdout: "pipe", stderr: "ignore" });
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  return parseAgentStatus(output);
}

export const RETRY_LADDER_MS = [30_000, 120_000, 600_000];

export interface RingResult {
  status: "ok" | "stalled" | "skipped";
  attempts: number;
}

async function herdrSpawn(agent: string, text: string): Promise<SpawnResult> {
  const proc = Bun.spawn(["herdr", "agent", "prompt", agent, text], { stdout: "pipe" });
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  return parseSpawnOutput(output);
}

async function retry(
  agent: string,
  text: string,
  spawn: Spawn,
  sleep: Sleep,
  ladder: number[],
  attempts: number,
): Promise<RingResult> {
  const result = await spawn(agent, text);
  const soFar = attempts + 1;
  if (result.status !== "agent_blocked") return { status: "ok", attempts: soFar };

  const [delay, ...rest] = ladder;
  if (delay === undefined) return { status: "stalled", attempts: soFar };

  await sleep(delay);
  return retry(agent, text, spawn, sleep, rest, soFar);
}

export function ring(
  agent: string,
  text = "/chief:chief drain",
  spawn: Spawn = herdrSpawn,
  sleep: Sleep = (ms) => Bun.sleep(ms),
): Promise<RingResult> {
  return retry(agent, text, spawn, sleep, RETRY_LADDER_MS, 0);
}
