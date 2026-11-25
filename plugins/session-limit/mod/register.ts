import type { On, PluginOptions, StateDollar } from "claude-code";
import { type Crossing, evaluate, summarize } from "./bands";

const MOD = "session-limit";
const ANNOUNCED = { plugin: "session-limit", key: "announced" } as const;
const MUTED = { plugin: "session-limit", key: "muted" } as const;

function crossingDetail(crossings: readonly Crossing[]) {
  return crossings.map(({ kind, threshold, percentUsed, resetsAt }) => ({
    kind,
    threshold,
    percentUsed,
    resetsAt: resetsAt ?? null,
  }));
}

async function mutedState($: StateDollar, mutedByDefault: boolean) {
  const { value } = await $.state.get(MUTED);
  return { muted: value ?? mutedByDefault, source: value === undefined ? "machine" : "session" };
}

export function register(on: On, options: PluginOptions): void {
  const overage = options.overage === true;
  const mutedByDefault = options.muted === true;

  on("session.start", ($, e, next) => {
    void $.modEvents.emit({ mod: MOD, event: "session.start" });
    $.command
      .register({
        name: "session-limit",
        description: "Mute or unmute usage limit notices for this session",
        argumentHint: "[on|off]",
      })
      .catch((error: unknown) => {
        void $.modEvents.emit({
          mod: MOD,
          event: "command.register",
          ok: false,
          detail: { error: String(error) },
        });
      });
    return next(e);
  });

  on("command.run", { command: "session-limit" }, async ($, e) => {
    const arg = e.args.trim();
    if (arg === "on" || arg === "off") {
      await $.state.set(MUTED, arg === "off");
      void $.modEvents.emit({ mod: MOD, event: "mute", detail: { muted: arg === "off" } });
    } else if (arg !== "") {
      return { text: "Usage: /session-limit [on|off]" };
    }
    const { muted, source } = await mutedState($, mutedByDefault);
    const scope = source === "machine" ? "machine default" : "this session";
    return { text: `Usage limit notices ${muted ? "muted" : "on"} (${scope})` };
  });

  // /clear and /resume start a new conversation without a session.start.
  on("session.end", async ($, e, next) => {
    if (e.reason === "clear" || e.reason === "resume") await $.state.set(ANNOUNCED, {});
    return next(e);
  });

  on("session.measure", async ($, e, next) => {
    if (!e.changed.includes("rateLimits")) return next(e);
    const { value: prev = {} } = await $.state.get(ANNOUNCED);
    const { announced, crossings } = evaluate(e.rateLimits, prev, await $.clock.now(), overage);
    if (crossings.length === 0) {
      await $.state.set(ANNOUNCED, announced);
      return next(e);
    }
    const { muted, source } = await mutedState($, mutedByDefault);
    if (muted) {
      await $.state.set(ANNOUNCED, announced);
      void $.modEvents.emit({
        mod: MOD,
        event: "muted",
        detail: { crossings: crossingDetail(crossings), source },
      });
      return next(e);
    }
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
    if (outcome.ok) {
      await $.state.set(ANNOUNCED, announced);
      $.ui.log(summarize(crossings));
    }
    void $.modEvents.emit({
      mod: MOD,
      event: "inject",
      ok: outcome.ok,
      detail: { crossings: crossingDetail(crossings), uuid: outcome.uuid, error: outcome.error },
    });
    return next(e);
  });
}
