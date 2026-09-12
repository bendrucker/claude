import { z } from "zod";

const SpawnResult = z.looseObject({ status: z.string() });
export type SpawnResult = z.infer<typeof SpawnResult>;

export type Spawn = (agent: string, text: string) => Promise<SpawnResult>;
export type Sleep = (ms: number) => Promise<void>;

export const RETRY_LADDER_MS = [30_000, 120_000, 600_000];

export interface RingResult {
  status: "ok" | "stalled";
  attempts: number;
}

async function herdrSpawn(agent: string, text: string): Promise<SpawnResult> {
  const proc = Bun.spawn(["herdr", "agent", "prompt", agent, text], { stdout: "pipe" });
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  return SpawnResult.parse(JSON.parse(output));
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
  text = "/chief drain",
  spawn: Spawn = herdrSpawn,
  sleep: Sleep = (ms) => Bun.sleep(ms),
): Promise<RingResult> {
  return retry(agent, text, spawn, sleep, RETRY_LADDER_MS, 0);
}
