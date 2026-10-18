import type { On, SessionRateLimit, UsageUnit } from "claude-code";
import { type Engine, describe, expect, mock, test } from "claude-code/testing";
import { BANDS, crossedBand, evaluate, formatResetTime } from "./bands";

const FIVE_RESETS = "2026-10-06T21:00:00.000Z";
const SEVEN_RESETS = "2026-10-12T06:00:00.000Z";
const NOW = Date.parse("2026-10-06T16:00:00.000Z");

function limits(fivePct: number, sevenPct = 0, fiveResets = FIVE_RESETS): SessionRateLimit[] {
  return [
    { kind: "five_hour", percentUsed: fivePct, resetsAt: fiveResets },
    { kind: "seven_day", percentUsed: sevenPct, resetsAt: SEVEN_RESETS },
  ];
}

interface World {
  events: unknown[];
  announced: unknown[];
  logs: string[];
}

function worldOf(
  on: On,
  { append = "refuse" }: { append?: "refuse" | "land" | "throw" } = {},
): World {
  const world: World = { events: [], announced: [], logs: [] };
  mock.clock(on, { now: NOW });
  if (append === "refuse") on("session.append", () => ({ deny: "refused" }));
  on("ui.log", ($, e) => {
    world.logs.push(e.text);
    return { value: undefined };
  });
  if (append === "throw")
    on("session.append", () => {
      throw new Error("append failed");
    });
  on("engine.create", async ($, e, next) => ({
    ...(await next(e)),
    modEvents: { emit: () => Promise.resolve() },
  }));
  on("modEvents.emit", ($, e) => {
    world.events.push(e);
    return { value: undefined };
  });
  on("session.measure", ($, e) => ({ changed: e.changed }));
  on("session.start", ($, e) => ({ cwd: e.cwd }));
  on("state.set", ($, e, next) => {
    world.announced.push(e.value);
    return next(e);
  });
  return world;
}

function measure($: Engine, rateLimits: SessionRateLimit[], changed: UsageUnit[] = ["rateLimits"]) {
  return $.session.measure({ context: { window: 200_000 }, rateLimits, changed });
}

describe("bands", () => {
  test("maps a percentage to the highest band it has crossed", () => {
    const five = BANDS.five_hour ?? [];
    const seven = BANDS.seven_day ?? [];
    expect([89, 90, 94, 95, 99, 100].map((pct) => crossedBand(pct, five)?.threshold ?? 0)).toEqual([
      0, 90, 90, 95, 95, 100,
    ]);
    expect([94, 95, 100].map((pct) => crossedBand(pct, seven)?.threshold ?? 0)).toEqual([
      0, 95, 95,
    ]);
  });

  test("announces only the highest newly crossed band", () => {
    const { crossings, announced } = evaluate(limits(96), {}, NOW);
    expect(crossings.map((c) => c.threshold)).toEqual([95]);
    expect(announced.five_hour).toEqual({ band: 95, resetsAt: FIVE_RESETS });
  });

  test("stays quiet for a band already announced in the same block", () => {
    const prev = { five_hour: { band: 95, resetsAt: FIVE_RESETS } };
    expect(evaluate(limits(97), prev, NOW).crossings).toEqual([]);
  });

  test("re-arms when the block rolls over", () => {
    const prev = { five_hour: { band: 95, resetsAt: "2026-10-06T16:00:00.000Z" } };
    expect(evaluate(limits(91), prev, NOW).crossings.map((c) => c.threshold)).toEqual([90]);
  });

  test("the exhausted message schedules a wake-up only within the horizon", () => {
    const soon = new Date(NOW + 30 * 60 * 1000).toISOString();
    const later = new Date(NOW + 2 * 60 * 60 * 1000).toISOString();
    const past = new Date(NOW - 60 * 1000).toISOString();
    const message = (resets: string) =>
      evaluate(limits(100, 0, resets), {}, NOW).crossings[0]?.message ?? "";
    expect(message(soon)).toContain("schedule a wake-up");
    expect(message(later)).toContain("tell the user to return");
    expect(message(past)).toContain("tell the user to return");
  });

  test("the exhausted message claims overage spend only when overage is on", () => {
    const message = (overage: boolean) =>
      evaluate(limits(100), {}, NOW, overage).crossings[0]?.message ?? "";
    expect(message(false)).not.toContain("overage");
    expect(message(true)).toContain("spends overage credits");
  });

  test("warns on the 7-day window alone", () => {
    const { crossings } = evaluate(limits(10, 95), {}, NOW);
    expect(crossings.map((c) => [c.kind, c.threshold])).toEqual([["seven_day", 95]]);
    expect(crossings[0]?.message).toContain("7-day usage limit");
  });
});

describe("register", () => {
  test("records the windows without announcing below the bands", async ($, on) => {
    const world = worldOf(on);
    await measure($, limits(42, 13));
    expect(world.announced).toEqual([
      {
        five_hour: { band: 0, resetsAt: FIVE_RESETS },
        seven_day: { band: 0, resetsAt: SEVEN_RESETS },
      },
    ]);
  });

  test("emits session.start", async ($, on) => {
    const world = worldOf(on);
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    expect(world.events).toEqual([{ mod: "session-limit", event: "session.start" }]);
  });

  test("logs a refused injection with the bands it carried", async ($, on) => {
    const world = worldOf(on);
    await measure($, limits(95, 95));
    expect(world.events).toEqual([
      {
        mod: "session-limit",
        event: "inject",
        ok: false,
        detail: {
          crossings: [
            { kind: "five_hour", threshold: 95, percentUsed: 95, resetsAt: FIVE_RESETS },
            { kind: "seven_day", threshold: 95, percentUsed: 95, resetsAt: SEVEN_RESETS },
          ],
          uuid: null,
          error: "refused",
        },
      },
    ]);
  });

  test("leaves a refused band unannounced so the next measurement retries", async ($, on) => {
    const world = worldOf(on);
    await measure($, limits(42));
    await measure($, limits(90));
    await measure($, limits(91));
    expect(world.announced).toHaveLength(1);
    expect(world.events.map((event) => JSON.stringify(event))).toEqual([
      expect.stringContaining('"percentUsed":90'),
      expect.stringContaining('"percentUsed":91'),
    ]);
  });

  test("announces a band once the injection lands", async ($, on) => {
    const world = worldOf(on, { append: "land" });
    await measure($, limits(90));
    await measure($, limits(91));
    const announced = {
      five_hour: { band: 90, resetsAt: FIVE_RESETS },
      seven_day: { band: 0, resetsAt: SEVEN_RESETS },
    };
    expect(world.announced).toEqual([announced, announced]);
    expect(world.events).toEqual([expect.objectContaining({ event: "inject", ok: true })]);
    expect(world.logs).toEqual([
      `Usage notice sent to Claude: 5-hour limit at 90% (resets ${formatResetTime(FIVE_RESETS)})`,
    ]);
  });

  test("logs nothing to the user when the injection is refused", async ($, on) => {
    const world = worldOf(on);
    await measure($, limits(95, 95));
    expect(world.logs).toEqual([]);
  });

  // The engine skips a throwing hook, so the row still lands beneath it.
  test("reports a landed injection when an append hook throws", async ($, on) => {
    const world = worldOf(on, { append: "throw" });
    const result = await measure($, limits(90));
    expect(result).toEqual({ changed: ["rateLimits"] });
    expect(world.announced).toHaveLength(1);
    expect(world.logs).toHaveLength(1);
    expect(world.events).toEqual([expect.objectContaining({ event: "inject", ok: true })]);
  });

  test("announces a limit with no reset time", async ($, on) => {
    const world = worldOf(on, { append: "land" });
    await measure($, [{ kind: "five_hour", percentUsed: 90 }]);
    expect(world.announced).toEqual([{ five_hour: { band: 90, resetsAt: "" } }]);
    expect(world.logs).toEqual(["Usage notice sent to Claude: 5-hour limit at 90%"]);
    expect(world.events).toEqual([
      expect.objectContaining({
        detail: expect.objectContaining({
          crossings: [{ kind: "five_hour", threshold: 90, percentUsed: 90, resetsAt: null }],
        }),
      }),
    ]);
  });

  // oxlint-disable-next-line vitest/prefer-each -- claude-code/testing has no test.each.
  for (const [reason, reannounced] of [
    ["clear", true],
    ["resume", true],
    ["prompt_input_exit", false],
  ] as const) {
    test(`after a session ends on ${reason}, re-announces a band: ${reannounced}`, async ($, on) => {
      const world = worldOf(on, { append: "land" });
      on("session.end", (_, e) => ({ sessionId: e.sessionId }));
      await measure($, limits(90));
      await $.session.end({ reason, sessionId: "s1", resume: { id: "s1" } });
      await measure($, limits(91));
      expect(world.logs).toHaveLength(reannounced ? 2 : 1);
    });
  }

  test("ignores measurements where rate limits did not move", async ($, on) => {
    const world = worldOf(on);
    await measure($, limits(99), ["context"]);
    expect(world.announced).toEqual([]);
    expect(world.events).toEqual([]);
  });

  test("stays idle off a subscription", async ($, on) => {
    const world = worldOf(on);
    await measure($, []);
    expect(world.announced).toEqual([{}]);
    expect(world.events).toEqual([]);
  });
});
