import type { On } from "claude-code";

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function register(on: On): void {
  let planFile: string | undefined;

  on("session.start", ($, e, next) => {
    void $.modEvents.emit({ mod: "plan", event: "session.start" });
    return next(e);
  });

  // /clear and /resume start a new conversation without a session.start.
  on("session.end", ($, e, next) => {
    if (e.reason === "clear" || e.reason === "resume") planFile = undefined;
    return next(e);
  });

  // The plan-mode reminder names the session's plan file, so sidecars beside it don't count.
  on("prompt.attachment", { type: "plan_mode" }, ($, e, next) => {
    if (e.agentId === undefined && e.detail?.planFilePath !== undefined) {
      planFile = e.detail.planFilePath;
    }
    return next(e);
  });

  on("tool.call", { tool: "ExitPlanMode" }, async ($, e, next) => {
    const result = await next(e);
    if (planFile === undefined) return result;

    let chars: number;
    try {
      chars = (await $.fs.read(planFile)).length;
    } catch {
      return result;
    }
    const denied = result.deny !== undefined || result.isError === true;
    await $.modEvents.emit({
      mod: "plan",
      event: "present",
      ok: !denied,
      detail: { file: basename(planFile), chars },
    });
    return result;
  }).catch(($, e, next) => next(e));
}
