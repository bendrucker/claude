import type { On } from "claude-code";

// The plan gate denies a plan whose `plan.length`, in UTF-16 code units, exceeds this.
export const LIMIT = 10_000;

export interface PlanCount {
  file: string;
  chars: number;
  limit: number;
  over: boolean;
  tool: string;
}

export interface PlanCrossed {
  file: string;
  chars: number;
  limit: number;
  direction: "over" | "under";
}

export function isPlanFile(filePath: string, home: string): boolean {
  const dir = `${home}/.claude/plans/`;
  return (
    filePath.startsWith(dir) &&
    filePath.endsWith(".md") &&
    !filePath.slice(dir.length).includes("/")
  );
}

function grouped(n: number): string {
  return String(n).replaceAll(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function statusText(chars: number): string {
  const base = `plan ${grouped(chars)} / ${grouped(LIMIT)}`;
  return chars > LIMIT ? `${base} (over by ${grouped(chars - LIMIT)})` : base;
}

export function register(on: On): void {
  const wasOver = new Map<string, boolean>();

  on("tool.call", { tool: ["Write", "Edit"] }, async ($, e, next) => {
    const result = await next(e);
    if (result.deny !== undefined || result.isError) return result;

    const home = await $.env.get("HOME");
    if (home === undefined || !isPlanFile(e.file_path, home)) return result;

    let chars: number;
    try {
      chars = (await $.fs.read(e.file_path)).length;
    } catch {
      return result;
    }

    const over = chars > LIMIT;
    const file = e.file_path.slice(e.file_path.lastIndexOf("/") + 1);
    $.ui.status(statusText(chars));
    await emit($, "plan.count", { file, chars, limit: LIMIT, over, tool: e.tool });

    const previous = wasOver.get(e.file_path);
    wasOver.set(e.file_path, over);
    if (previous !== undefined && previous !== over) {
      await emit($, "plan.crossed", {
        file,
        chars,
        limit: LIMIT,
        direction: over ? "over" : "under",
      });
    }
    return result;
  });

  on("tool.call", { tool: "ExitPlanMode" }, async ($, e, next) => {
    const result = await next(e);
    if (result.deny === undefined && !result.isError) $.ui.status(undefined);
    return result;
  });
}

// Placeholder until the mods-observability event writer lands.
async function emit(_$: unknown, _event: string, _data: PlanCount | PlanCrossed): Promise<void> {}
