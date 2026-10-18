import type { On } from "claude-code";

// The plan gate denies a plan whose `plan.length`, in UTF-16 code units, exceeds this.
export const LIMIT = 10_000;
const SHOWN_FROM = LIMIT * 0.9;

function percent(chars: number): number {
  return Math.floor((chars * 100) / LIMIT);
}

// Both figures round down so a plan under the limit never reads 10k or 100%.
export function statusText(chars: number): string | undefined {
  if (chars < SHOWN_FROM) return undefined;
  return `${Math.floor(chars / 100) / 10}k (${percent(chars)}%)`;
}

// A plan this large has slices worth delegating, so it gets the delegation guidance.
export const DELEGATION_FROM = LIMIT / 2;
const DELEGATION_HEADING = /^#{1,6}\s+Delegation\b/m;

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function register(on: On): void {
  let planFile: string | undefined;
  let planning = false;
  let shown = false;
  let wasOver = false;
  // Once per conversation: the guidelines stay in context until a compaction.
  let injected = false;
  let delegated = false;

  on("session.start", ($, e, next) => {
    void $.modEvents.emit({ mod: "plan", event: "session.start" });
    return next(e);
  });

  // /clear and /resume start a new conversation without a session.start.
  on("session.end", ($, e, next) => {
    if (e.reason !== "clear" && e.reason !== "resume") return next(e);
    planning = false;
    planFile = undefined;
    wasOver = false;
    injected = false;
    delegated = false;
    if (shown) {
      shown = false;
      $.ui.status(undefined);
    }
    return next(e);
  });

  on("session.compact", async ($, e, next) => {
    const result = await next(e);
    if (e.agentId === undefined && result.skip === undefined) injected = false;
    return result;
  }).catch(($, e, next) => next(e));

  // The plan-mode reminder names the session's plan file, so sidecars beside it don't count.
  // Its full wording opens every planning session and follows every compaction, whichever
  // way plan mode was reached, so the guidelines ride on the first one.
  on("prompt.attachment", { type: "plan_mode" }, async ($, e, next) => {
    if (e.agentId !== undefined) return next(e);
    planning = true;
    const path = e.detail?.planFilePath;
    if (path !== undefined && path !== planFile) {
      planFile = path;
      wasOver = false;
      delegated = false;
    }
    const result = await next(e);
    if (injected || e.detail?.reminder !== "full" || result.text === null) return result;
    injected = true;
    let guidelines: string;
    try {
      guidelines = await $.fs.read(`${$.plugin.root}/references/guidelines.md`);
    } catch {
      void $.modEvents.emit({ mod: "plan", event: "inject", ok: false });
      return result;
    }
    void $.modEvents.emit({ mod: "plan", event: "inject", ok: true });
    return { text: `${result.text}\n\n${guidelines}` };
  }).catch(($, e, next) => next(e));

  // Plan mode can end without ExitPlanMode, as when the user cycles out of it.
  on("prompt.attachment", { type: "plan_mode_exit" }, ($, e, next) => {
    if (e.agentId !== undefined) return next(e);
    planning = false;
    if (shown) {
      shown = false;
      $.ui.status(undefined);
    }
    return next(e);
  });

  on("tool.call", { tool: ["Write", "Edit"] }, async ($, e, next) => {
    const result = await next(e);
    if (!planning || e.file_path !== planFile || result.deny !== undefined || result.isError)
      return result;

    let plan: string;
    try {
      plan = await $.fs.read(e.file_path);
    } catch {
      if (shown) {
        shown = false;
        $.ui.status(undefined);
      }
      return result;
    }

    const chars = plan.length;
    const over = chars > LIMIT;
    const file = basename(e.file_path);
    const text = statusText(chars);
    if (text !== undefined || shown) $.ui.status(text);
    shown = text !== undefined;
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

    if (delegated || chars < DELEGATION_FROM || DELEGATION_HEADING.test(plan)) return result;
    delegated = true;
    let delegation: string;
    try {
      delegation = await $.fs.read(`${$.plugin.root}/references/delegation.md`);
    } catch {
      await $.modEvents.emit({
        mod: "plan",
        event: "delegation",
        ok: false,
        detail: { file, chars },
      });
      return result;
    }
    await $.modEvents.emit({ mod: "plan", event: "delegation", ok: true, detail: { file, chars } });
    return { ...result, context: [...(result.context ?? []), delegation] };
  }).catch(($, e, next) => next(e));

  on("tool.call", { tool: "ExitPlanMode" }, async ($, e, next) => {
    const result = await next(e);
    const denied = result.deny !== undefined || result.isError === true;
    if (!denied) planning = false;
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
