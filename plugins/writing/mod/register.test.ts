import type { EngineInterface, On } from "claude-code";
import { expect, test, tier } from "claude-code/testing";

type ModEventsInput = Parameters<EngineInterface["modEvents"]["emit"]>[0];

tier("user");

function recordEvents(on: On): ModEventsInput[] {
  const events: ModEventsInput[] = [];
  on("engine.create", async ($, e, next) => ({
    ...(await next(e)),
    modEvents: { emit: () => Promise.resolve() },
  }));
  on("modEvents.emit", ($, e) => {
    events.push(e);
    return { value: undefined };
  });
  on("session.start", ($, e) => ({ cwd: e.cwd }));
  return events;
}

// The kit cannot raise a session.append chain (its bottom hook is skipped for answering
// without next), so the meter's row handling is covered through meter.ts.
test("emits session.start once the session is ready", async ($, on) => {
  const events = recordEvents(on);

  await $.session.start({ cwd: "/repo", surface: "terminal", isInteractive: true });

  expect(events).toEqual([{ mod: "writing", event: "session.start" }]);
});
