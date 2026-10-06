import type { On } from "claude-code";
import { evaluate, statusText } from "./bands";

const MOD = "session-limit";
const ANNOUNCED = { plugin: "session-limit", key: "announced" } as const;

export function register(on: On): void {
  on("session.start", ($, e, next) => {
    void $.modEvents.emit({ mod: MOD, event: "session.start" });
    return next(e);
  });

  on("session.measure", async ($, e, next) => {
    if (!e.changed.includes("rateLimits")) return next(e);

    $.ui.status(statusText(e.rateLimits));

    const { value: prev = {} } = await $.state.get(ANNOUNCED);
    const { announced, crossings } = evaluate(e.rateLimits, prev, await $.clock.now());

    if (crossings.length === 0) {
      await $.state.set(ANNOUNCED, announced);
    } else {
      const text = crossings.map((crossing) => crossing.message).join("\n\n");
      const outcome = await $.session
        .append({ message: { type: "user", content: [{ type: "text", text }] } })
        .then(
          (result) => ({
            ok: result.deny === undefined,
            uuid: result.uuid ?? null,
            error: result.deny ?? null,
          }),
          (error: unknown) => ({ ok: false, uuid: null, error: String(error) }),
        );
      // A refused append leaves the bands unannounced so the next measurement retries.
      if (outcome.ok) await $.state.set(ANNOUNCED, announced);
      void $.modEvents.emit({
        mod: MOD,
        event: "inject",
        ok: outcome.ok,
        detail: {
          crossings: crossings.map(({ kind, threshold, percentUsed, resetsAt }) => ({
            kind,
            threshold,
            percentUsed,
            resetsAt: resetsAt ?? null,
          })),
          uuid: outcome.uuid,
          error: outcome.error,
        },
      });
    }
    return next(e);
  });
}
