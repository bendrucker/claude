import { expect, test } from "bun:test";
import { RETRY_LADDER_MS, ring, type SpawnResult } from "./doorbell";

function statusSequence(statuses: string[]): {
  spawn: () => Promise<SpawnResult>;
  calls: () => number;
} {
  let index = 0;
  return {
    spawn: () => {
      const status = statuses[index] ?? statuses.at(-1) ?? "agent_blocked";
      index += 1;
      return Promise.resolve({ status });
    },
    calls: () => index,
  };
}

test("succeeds on the first spawn with no retries", async () => {
  const { spawn, calls } = statusSequence(["ok"]);
  const sleeps: number[] = [];
  const result = await ring("chief", "/chief:chief drain", spawn, (ms) => {
    sleeps.push(ms);
    return Promise.resolve();
  });
  expect(result).toEqual({ status: "ok", attempts: 1 });
  expect(sleeps).toEqual([]);
  expect(calls()).toBe(1);
});

test("retries through the ladder until the agent unblocks", async () => {
  const { spawn } = statusSequence(["agent_blocked", "agent_blocked", "ok"]);
  const sleeps: number[] = [];
  const result = await ring("chief", "/chief:chief drain", spawn, (ms) => {
    sleeps.push(ms);
    return Promise.resolve();
  });
  expect(result).toEqual({ status: "ok", attempts: 3 });
  expect(sleeps).toEqual(RETRY_LADDER_MS.slice(0, 2));
});

test("reports stalled after exhausting the ladder", async () => {
  const { spawn } = statusSequence(["agent_blocked"]);
  const sleeps: number[] = [];
  const result = await ring("chief", "/chief:chief drain", spawn, (ms) => {
    sleeps.push(ms);
    return Promise.resolve();
  });
  expect(result).toEqual({ status: "stalled", attempts: RETRY_LADDER_MS.length + 1 });
  expect(sleeps).toEqual(RETRY_LADDER_MS);
});
