import { expect, test } from "bun:test";
import { isWorkHours, start } from "./timers";

test.each([
  ["09:00", true],
  ["08:59", false],
  ["17:59", true],
  ["18:00", false],
])("%s within 09:00-18:00 is %s", (time, expected) => {
  const [hours, minutes] = time.split(":").map(Number);
  const now = new Date(2026, 0, 1, hours, minutes);
  expect(isWorkHours(now, ["09:00", "18:00"])).toBe(expected);
});

test("schedules a release check every tick and clears both timers on stop", () => {
  const scheduled: { fn: () => void; ms: number }[] = [];
  const cleared: unknown[] = [];
  let calls = 0;

  const fakeClear = ((id: unknown) => {
    cleared.push(id);
  }) as typeof clearInterval;

  const handle = start({
    releaseCheck: () => {
      calls += 1;
    },
    flockTick: () => {
      calls += 1;
    },
    workHours: ["09:00", "18:00"],
    now: () => new Date(2026, 0, 1, 12, 0),
    schedule: (fn, ms) => {
      scheduled.push({ fn, ms });
      return scheduled.length as unknown as Timer;
    },
  });

  expect(scheduled.map((s) => s.ms)).toEqual([60_000, 1_200_000]);
  scheduled[0]?.fn();
  scheduled[1]?.fn();
  expect(calls).toBe(2);

  const originalClearInterval = globalThis.clearInterval;
  globalThis.clearInterval = fakeClear;
  handle.stop();
  globalThis.clearInterval = originalClearInterval;
  expect(cleared).toEqual([1, 2]);
});

test("skips the /flock tick outside work hours", () => {
  const scheduled: (() => void)[] = [];
  let flockCalls = 0;

  start({
    releaseCheck: () => {},
    flockTick: () => {
      flockCalls += 1;
    },
    workHours: ["09:00", "18:00"],
    now: () => new Date(2026, 0, 1, 20, 0),
    schedule: (fn) => {
      scheduled.push(fn);
      return 0 as unknown as Timer;
    },
  });

  scheduled[1]?.();
  expect(flockCalls).toBe(0);
});
