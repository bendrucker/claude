import type { On } from "claude-code";

// The plan gate denies a plan whose `plan.length`, in UTF-16 code units, exceeds this.
export const LIMIT = 10_000;

export function percent(chars: number): number {
  return Math.floor((chars * 100) / LIMIT);
}

export function statusText(chars: number): string {
  return `plan ${percent(chars)}%${chars > LIMIT ? " ✗" : ""}`;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function register(on: On): void {
  let planFile: string | undefined;
  let shown = false;
  let wasOver = false;

  on("session.start", ($, e, next) => {
    void $.modEvents.emit({ mod: "plan", event: "session.start" });
    return next(e);
  });

  // The plan-mode reminder names the session's plan file, so sidecars beside it don't count.
  on("prompt.attachment", { type: "plan_mode" }, ($, e, next) => {
    const path = e.detail?.planFilePath;
    if (e.agentId === undefined && path !== undefined && path !== planFile) {
      planFile = path;
      wasOver = false;
    }
    return next(e);
  });

  on("tool.call", { tool: ["Write", "Edit"] }, async ($, e, next) => {
    const result = await next(e);
    if (e.file_path !== planFile || result.deny !== undefined || result.isError) return result;

    let chars: number;
    try {
      chars = (await $.fs.read(e.file_path)).length;
    } catch {
      shown = false;
      $.ui.status(undefined);
      return result;
    }

    const over = chars > LIMIT;
    const file = basename(e.file_path);
    shown = true;
    $.ui.status(statusText(chars));
    await $.modEvents.emit({
      mod: "plan",
      event: "count",
      detail: { file, chars, limit: LIMIT, over, tool: e.tool },
    });
    if (over !== wasOver) {
      await $.modEvents.emit({
        mod: "plan",
        event: "crossed",
        detail: { file, chars, limit: LIMIT, direction: over ? "over" : "under" },
      });
    }
    wasOver = over;
    return result;
  }).catch(($, e, next) => next(e));

  on("tool.call", { tool: "ExitPlanMode" }, async ($, e, next) => {
    const result = await next(e);
    const denied = result.deny !== undefined || result.isError === true;
    if (!denied && shown) {
      shown = false;
      $.ui.status(undefined);
    }
    if (planFile === undefined) return result;

    let chars: number;
    try {
      chars = (await $.fs.read(planFile)).length;
    } catch {
      if (shown) {
        shown = false;
        $.ui.status(undefined);
      }
      return result;
    }
    await $.modEvents.emit({
      mod: "plan",
      event: "present",
      ok: !denied,
      detail: { file: basename(planFile), chars, limit: LIMIT, over: chars > LIMIT },
    });
    return result;
  }).catch(($, e, next) => next(e));
}
