import type { EngineInterface, On } from "claude-code";
import { type Class, explain } from "./explain";
import { rewrite } from "./rewrite";
import { type Shell, detect } from "./shell";

const MOD = "zsh";

interface State {
  shell: Shell | undefined;
  seen: Set<Class>;
}

function failed($: EngineInterface, hook: string, kind: string, message?: string): void {
  $.modEvents
    .emit({ mod: MOD, event: "error", ok: false, detail: { hook, kind, message: message ?? null } })
    .catch(() => undefined);
}

export function register(on: On): void {
  const state: State = { shell: undefined, seen: new Set() };

  on("session.start", async ($, e, next) => {
    const shell = await detect($);
    state.shell = shell;
    state.seen.clear();
    void $.modEvents.emit({
      mod: MOD,
      event: "session.start",
      detail: {
        shell: shell.path,
        version: shell.version,
        active: shell.active,
        ...Object.fromEntries(
          Object.entries(shell.options).map(([name, set]) => [name, set ? "on" : "off"]),
        ),
      },
    });
    if (shell.error !== null) failed($, "session.start", "probe", shell.error);
    return next(e);
  }).catch(($, e, next) => {
    failed($, "session.start", next.error.kind, next.error.message);
    return next(e);
  });

  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const shell = state.shell;
    if (shell === undefined || !shell.active) return next(e);

    const { command, rules } = rewrite(e.command, shell.gates);
    if (rules.length > 0) void $.modEvents.emit({ mod: MOD, event: "rewrite", detail: { rules } });
    const r = await next(rules.length > 0 ? { ...e, command } : e);
    if (r.deny !== undefined) return r;

    const notes = explain(r.text ?? "", state.seen);
    for (const n of notes) {
      void $.modEvents.emit({
        mod: MOD,
        event: "explain",
        detail: { class: n.class, repeat: n.repeat },
      });
    }
    if (notes.length === 0) return r;
    return { ...r, context: [...(r.context ?? []), ...notes.map((n) => n.note)] };
    // Fails open: a broken rewrite or note must never block the command.
  }).catch(($, e, next) => {
    failed($, "tool.call", next.error.kind, next.error.message);
    return next(e);
  });
}
