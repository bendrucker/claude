#!/usr/bin/env bun

import { join } from "node:path";
import { z } from "zod";
import { type HookAlert, MAX_REPORTED, report } from "../../hooks/report";

const Severity = z.enum(["error", "warning", "suggestion"]);
const Arm = z.enum(["flat", "inline", "stop"]);
type Arm = z.infer<typeof Arm>;

const Scenario = z.object({
  path: z.string(),
  findings: z.array(
    z.object({
      severity: Severity,
      check: z.string(),
      message: z.string(),
      phrase: z.string(),
    }),
  ),
});
type Scenario = z.infer<typeof Scenario>;

const Pending = z.object({
  check: z.string(),
  decision: z.enum(["deny", "context"]),
  severity: Severity,
  message: z.string(),
  at: z.string(),
  filePath: z.string().optional(),
}) satisfies z.ZodType<DeferredAlert>;
const State = z.object({ fired: z.boolean(), pending: z.array(Pending) });

const Input = z.looseObject({
  hook_event_name: z.string(),
  cwd: z.string(),
  tool_input: z.looseObject({ file_path: z.string().optional() }).optional(),
});

/** Locates each finding's phrase in the file as Vale would report it, dropping any the model already removed. */
export function locate(scenario: Scenario, text: string): HookAlert[] {
  const lines = text.split("\n");
  return scenario.findings.flatMap((finding) => {
    const row = lines.findIndex((line) => line.includes(finding.phrase));
    if (row === -1) return [];
    const column = (lines[row] ?? "").indexOf(finding.phrase) + 1;
    return [
      {
        check: finding.check,
        decision: "context",
        severity: finding.severity,
        message: finding.message,
        at: `${row + 1}:${column}`,
      },
    ];
  });
}

interface DeferredAlert extends HookAlert {
  filePath?: string | undefined;
}

/** The stop arm's end-of-turn text for the suggestions the turn's edits raised. */
export function renderDeferred(alerts: DeferredAlert[]): string {
  const lines = [
    "Vale suggestions from this turn. They are low-confidence and optional: edit your work to apply any that make it better, and end the turn when none do.",
    "",
  ];
  for (const alert of alerts.slice(0, MAX_REPORTED)) {
    const where = alert.filePath === undefined ? "" : `\`${alert.filePath}\` `;
    lines.push(`- ${where}${alert.at} ${alert.check}: ${alert.message}`);
  }
  return lines.join("\n");
}

/** The hook text from before severity framing: one "Fix them" over every alert. */
export function renderFlat(alerts: HookAlert[], filePath: string): string {
  const lines = [
    `Vale found ${alerts.length} alerts in \`${filePath}\`. Fix them in one pass.`,
    "",
  ];
  for (const alert of alerts) lines.push(`- ${alert.at} ${alert.check}: ${alert.message}`);
  return lines.join("\n");
}

function inFile(alert: HookAlert, filePath: string): DeferredAlert {
  return { ...alert, filePath };
}

/** The PostToolUse context for an arm, and the suggestions it holds back for Stop. */
export function surface(
  arm: Arm,
  alerts: HookAlert[],
  filePath: string,
): { context: string; pending: DeferredAlert[] } {
  if (arm === "flat") return { context: renderFlat(alerts, filePath), pending: [] };
  const held = arm === "stop" ? alerts.filter((alert) => alert.severity === "suggestion") : [];
  const now = alerts.filter((alert) => !held.includes(alert));
  const result = report(now, { event: "PostToolUse", filePath });
  const specific = result?.output.hookSpecificOutput;
  const context =
    specific !== undefined && "additionalContext" in specific
      ? (specific.additionalContext ?? "")
      : "";
  return { context, pending: held.map((alert) => inFile(alert, filePath)) };
}

async function main(): Promise<void> {
  const input = Input.parse(JSON.parse(await Bun.stdin.text()));
  const git = join(input.cwd, ".git");
  const arm = Arm.parse(process.argv[2]);
  const scenario = Scenario.parse(await Bun.file(join(git, "eval-scenario.json")).json());
  const statePath = join(git, "eval-state.json");
  const stateFile = Bun.file(statePath);
  const state = (await stateFile.exists())
    ? State.parse(await stateFile.json())
    : { fired: false, pending: [] };

  if (input.hook_event_name === "Stop") {
    if (state.pending.length === 0) return;
    const { pending } = state;
    await Bun.write(statePath, JSON.stringify({ ...state, pending: [] }));
    process.stdout.write(
      `${JSON.stringify({ hookSpecificOutput: { hookEventName: "Stop", additionalContext: renderDeferred(pending) } })}\n`,
    );
    return;
  }

  const filePath = input.tool_input?.file_path ?? "";
  if (state.fired || !filePath.endsWith(scenario.path)) return;
  const alerts = locate(scenario, await Bun.file(filePath).text());
  const { context, pending } = surface(arm, alerts, scenario.path);
  await Bun.write(statePath, JSON.stringify({ fired: true, pending }));
  if (context === "") return;
  process.stdout.write(
    `${JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: context } })}\n`,
  );
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
  });
}
