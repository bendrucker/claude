import type { On, TurnStepInput } from "claude-code";
import { describe, expect, test, type Engine } from "claude-code/testing";
import { hintOf } from "./register";

const START = { surface: "terminal", isInteractive: true, cwd: "/work" } as const;

const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";

const IDLE_AUTO = "(shift+tab to cycle) · ← for agents";

function worldOf(on: On, model: string) {
  const events: { event: string; detail?: Readonly<Record<string, unknown>> | undefined }[] = [];
  const hints: string[] = [];
  const invalidations: unknown[] = [];
  on("engine.create", async ($, e, next) => ({
    ...(await next(e)),
    modEvents: { emit: () => Promise.resolve() },
  }));
  on("modEvents.emit", ($, e) => {
    events.push(e);
    return { value: undefined };
  });
  on("session.start", ($, e) => ({ cwd: e.cwd }));
  on("session.model", () => ({ value: model }));
  on("ui.invalidate", ($, e) => {
    invalidations.push(e);
    return { value: undefined };
  });
  on("ui.render", { component: "PromptHint" }, ($, e) => {
    hints.push(e.props.hint);
    return $.ui.resolve(e).Text({ children: e.props.hint });
  });
  on("turn.step", async function* () {
    yield* await Promise.resolve([]);
    return {
      turnId: "t1",
      index: 0,
      answer: "",
      toolUses: [],
      serverToolUses: [],
      stopReason: "end_turn",
      usage: null,
    };
  });
  const shown = async ($: Engine, hint = IDLE_AUTO) => {
    await $.ui.mount({
      plugin: "session-config",
      surface: "terminal",
      component: "PromptHint",
      props: { isDraft: false, isWorking: false, hint },
    });
    return hints.at(-1);
  };
  return { events, invalidations, shown };
}

async function step($: Engine, model: string, effort?: TurnStepInput["effort"]) {
  const input: TurnStepInput = {
    turnId: "t1",
    index: 0,
    model,
    messageCount: 1,
    ...(effort !== undefined && { effort }),
  };
  for await (const _ of $.turn.step(input));
}

describe("register", () => {
  test("opus at high effort shows the family alone", async ($, on) => {
    const w = worldOf(on, OPUS);
    await $.session.start(START);
    await step($, OPUS, "high");
    expect(await w.shown($)).toBe("opus");
    expect(w.events.map((e) => e.event).toSorted()).toEqual(["config.change", "session.start"]);
  });

  test("sonnet at high effort shows the family alone", async ($, on) => {
    const w = worldOf(on, SONNET);
    await $.session.start(START);
    await step($, SONNET, "high");
    expect(await w.shown($)).toBe("sonnet");
  });

  test("opus at low effort adds the level", async ($, on) => {
    const w = worldOf(on, OPUS);
    await $.session.start(START);
    await step($, OPUS, "low");
    expect(await w.shown($)).toBe("opus · low");
  });

  test("the level appears once a turn reports it", async ($, on) => {
    const w = worldOf(on, SONNET);
    await $.session.start(START);
    expect(await w.shown($)).toBe("sonnet");
    await step($, SONNET, "low");
    expect(await w.shown($)).toBe("sonnet · low");
    expect(w.events.filter((e) => e.event === "config.change").map((e) => e.detail)).toEqual([
      { label: "sonnet" },
      { label: "sonnet · low" },
    ]);
  });

  test("live hint parts stay ahead of the label", async ($, on) => {
    const w = worldOf(on, SONNET);
    await $.session.start(START);
    expect(await w.shown($, "esc to interrupt · ↓ to manage")).toBe(
      "esc to interrupt · ↓ to manage · sonnet",
    );
  });

  test("a numeric effort adds no level", async ($, on) => {
    const w = worldOf(on, SONNET);
    await $.session.start(START);
    await step($, SONNET, 4096);
    expect(await w.shown($)).toBe("sonnet");
  });

  test("a model switch shows on the next main-loop step", async ($, on) => {
    const w = worldOf(on, OPUS);
    await $.session.start(START);
    expect(await w.shown($)).toBe("opus");
    await step($, SONNET, "high");
    expect(await w.shown($)).toBe("sonnet");
  });

  test("a repeated step with the same config draws no new frame", async ($, on) => {
    const w = worldOf(on, OPUS);
    await $.session.start(START);
    await step($, OPUS, "low");
    await step($, OPUS, "low");
    expect(w.invalidations).toHaveLength(2);
  });

  test("hintOf drops key help and fits the label to the row", () => {
    const cases = [
      { name: "idle auto, no label", hint: IDLE_AUTO, label: [], columns: 45, want: "" },
      { name: "idle auto", hint: IDLE_AUTO, label: ["opus"], columns: 45, want: "opus" },
      {
        name: "off-default at phone width",
        hint: IDLE_AUTO,
        label: ["sonnet", "low"],
        columns: 45,
        want: "sonnet · low",
      },
      {
        name: "working at phone width drops the level first",
        hint: "↓ to manage",
        label: ["haiku", "medium"],
        columns: 45,
        want: "↓ to manage · haiku",
      },
      {
        name: "live parts stay when no label fits",
        hint: "(shift+tab to cycle) · esc to interrupt · ↓ to manage",
        label: ["sonnet", "low"],
        columns: 45,
        want: "esc to interrupt · ↓ to manage",
      },
      {
        name: "no viewport, no limit",
        hint: "? for shortcuts",
        label: ["sonnet", "low"],
        columns: undefined,
        want: "? for shortcuts · sonnet · low",
      },
    ];
    for (const { name, hint, label, columns, want } of cases)
      expect([name, hintOf(hint, label, columns)]).toEqual([name, want]);
  });
});
