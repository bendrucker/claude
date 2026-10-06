import type { On } from "claude-code";
import { evaluate, statusText } from "./bands";

const ANNOUNCED = { plugin: "session-limit", key: "announced" } as const;

export function register(on: On): void {
  on("session.measure", async ($, e, next) => {
    if (!e.changed.includes("rateLimits")) return next(e);

    $.ui.status(statusText(e.rateLimits));

    const { value: prev = {} } = await $.state.get(ANNOUNCED);
    const { announced, crossings } = evaluate(e.rateLimits, prev, await $.clock.now());
    await $.state.set(ANNOUNCED, announced);

    if (crossings.length > 0) {
      const text = crossings.map((crossing) => crossing.message).join("\n\n");
      await $.session.append({ message: { type: "user", content: [{ type: "text", text }] } });
    }
    return next(e);
  });
}
