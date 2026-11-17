import type { EngineInterface, On } from "claude-code";

const MOD = "session-config";

const FAMILIES = ["opus", "sonnet", "haiku", "fable"] as const;
const DEFAULT_EFFORT = "high";

function modelFamily(id: string | undefined): string | undefined {
  const hay = (id ?? "").toLowerCase();
  return FAMILIES.find((family) => hay.includes(family));
}

// Static key help the engine repeats on every idle prompt. Matched exactly, so
// reworded text falls through and the line draws as the engine has it.
const KEY_HELP = new Set(["(shift+tab to cycle)", "← for agents"]);

// The mode pill is drawn outside the hint, and a mod can't read it. The room
// left for the hint assumes the widest common pill (`⏵⏵ accept edits on`) plus
// the indent and the engine's separator. A hint past the row wraps that
// separator onto a line of its own.
const ROW_RESERVE = 25;

const SEPARATOR = " · ";

const graphemes = new Intl.Segmenter();

function cells(text: string): number {
  return [...graphemes.segment(text)].length;
}

export function hintOf(hint: string, label: string[], columns?: number): string {
  const parts = hint.split(SEPARATOR).filter((part) => part !== "" && !KEY_HELP.has(part.trim()));
  const room = columns === undefined ? Infinity : columns - ROW_RESERVE;
  for (const part of label) {
    if (cells([...parts, part].join(SEPARATOR)) > room) break;
    parts.push(part);
  }
  return parts.join(SEPARATOR);
}

interface Config {
  family?: string | undefined;
  effort?: string | number | undefined;
  label: string[];
}

function labelOf({ family, effort }: Config): string[] {
  const parts: string[] = [];
  if (family !== undefined) parts.push(family);
  if (typeof effort === "string" && effort !== DEFAULT_EFFORT) parts.push(effort);
  return parts;
}

function refresh($: EngineInterface, config: Config) {
  const label = labelOf(config);
  if (label.join(SEPARATOR) === config.label.join(SEPARATOR)) return;
  config.label = label;
  $.ui.invalidate("ui.render");
  void $.modEvents.emit({
    mod: MOD,
    event: "config.change",
    detail: { label: label.join(SEPARATOR) },
  });
}

export function register(on: On): void {
  const config: Config = { label: [] };

  on("session.start", async ($, e, next) => {
    config.family = modelFamily(await $.session.model());
    void $.modEvents.emit({ mod: MOD, event: "session.start" });
    refresh($, config);
    return next(e);
  }).catch(($, e, next) => next(e));

  on("session.model", async ($, e, next) => {
    const result = await next(e);
    config.family = modelFamily(result.value);
    refresh($, config);
    return result;
  }).catch(($, e, next) => next(e));

  on("turn.step", async function* ($, e, next) {
    if (e.agentId === undefined) {
      config.family = modelFamily(e.model) ?? config.family;
      config.effort = e.effort;
      refresh($, config);
    }
    return yield* next(e);
  });

  // The engine draws a separator after the mode pill even for an empty hint.
  // The label goes in the hint to give that separator something to separate.
  on("ui.render", { component: "PromptHint" }, ($, e, next) => {
    const hint = hintOf(e.props.hint, config.label, e.viewport?.columns);
    return hint === e.props.hint ? next(e) : next({ ...e, props: { ...e.props, hint } });
  });
}
