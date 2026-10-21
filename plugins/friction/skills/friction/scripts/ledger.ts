#!/usr/bin/env bun
// The friction ledger: one JSONL file of findings, outcomes, and runs. The model
// emits findings and this script counts them and decides what surfaces, so a
// count never depends on the model remembering yesterday.

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Argument, Command, Option } from "@commander-js/extra-typings";
import { z } from "zod";

export const TYPES = [
  "contention",
  "slow-command",
  "failing-command",
  "tool-gap",
  "upstream-change",
  "config-drift",
] as const;
export const IMPACTS = ["low", "moderate", "high"] as const;
export const OUTCOMES = ["filed", "picked", "resolved", "dismissed"] as const;
export const WINDOWS = ["1d", "7d"] as const;

type Impact = (typeof IMPACTS)[number];
type Outcome = (typeof OUTCOMES)[number];
type Window = (typeof WINDOWS)[number];

// Days a symptom must recur in the trailing week before the daily run acts on it.
const TRAILING_DAYS = 7;
const SUPPRESS_DAYS = 30;
const BELOW_CUT = 5;
const WEEKLY_TOP = 5;

export const FindingInput = z.object({
  type: z.enum(TYPES),
  target: z.string().min(1),
  impact: z.enum(IMPACTS),
  metric: z.string().min(1),
  fix: z.string().min(1),
  small: z.boolean(),
});
export type FindingInput = z.infer<typeof FindingInput>;

const Stamp = { fp: z.string(), day: z.string(), at: z.string() };
const FindingLine = FindingInput.extend({ kind: z.literal("finding"), ...Stamp });
const OutcomeLine = z.object({
  kind: z.literal("outcome"),
  ...Stamp,
  outcome: z.enum(OUTCOMES),
  ref: z.string().optional(),
});
const RunLine = z.object({
  kind: z.literal("run"),
  day: z.string(),
  at: z.string(),
  window: z.enum(WINDOWS),
  findings: z.number(),
  promoted: z.array(z.string()),
});
const Line = z.discriminatedUnion("kind", [FindingLine, OutcomeLine, RunLine]);
type FindingLine = z.infer<typeof FindingLine>;
type OutcomeLine = z.infer<typeof OutcomeLine>;
type Line = z.infer<typeof Line>;

export type Status = "open" | "filed" | "suppressed" | "resolved";

export interface Entry {
  fp: string;
  latest: FindingLine;
  firstSeen: string;
  daysSeen: number;
  status: Status;
  regression: boolean;
}

export interface Decision {
  window: Window;
  day: string;
  promote: Entry[];
  belowCut: Entry[];
  ledgerOnly: number;
}

export function ledgerPath(): string {
  const { FRICTION_LEDGER, XDG_STATE_HOME } = process.env;
  if (FRICTION_LEDGER !== undefined && FRICTION_LEDGER !== "") return FRICTION_LEDGER;
  const state =
    XDG_STATE_HOME !== undefined && XDG_STATE_HOME !== ""
      ? XDG_STATE_HOME
      : join(homedir(), ".local", "state");
  return join(state, "friction", "ledger.jsonl");
}

export function normalizeTarget(target: string): string {
  return target.trim().toLowerCase().replaceAll(/\s+/g, " ");
}

export function fingerprint(type: string, target: string): string {
  return createHash("sha256")
    .update(`${type}|${normalizeTarget(target)}`)
    .digest("hex")
    .slice(0, 12);
}

export function localDay(date = new Date()): string {
  return date.toLocaleDateString("en-CA");
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function readLedger(path: string): Promise<Line[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) return [];
  return (await file.text())
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => Line.parse(JSON.parse(line)));
}

async function append(path: string, lines: Line[]): Promise<void> {
  if (lines.length === 0) return;
  const file = Bun.file(path);
  const existing = (await file.exists()) ? await file.text() : "";
  mkdirSync(dirname(path), { recursive: true });
  await Bun.write(path, existing + lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
}

// Per-fingerprint state as of `day`. Sightings before a resolution belong to the
// fixed symptom, so only later ones count toward its return.
export function reduce(lines: Line[], day: string): Map<string, Entry> {
  const groups = new Map<
    string,
    { first: FindingLine; latest: FindingLine; seen: FindingLine[] }
  >();
  const outcomes = new Map<string, OutcomeLine[]>();
  for (const line of lines) {
    if (line.day > day) continue;
    if (line.kind === "outcome") outcomes.set(line.fp, [...(outcomes.get(line.fp) ?? []), line]);
    if (line.kind !== "finding") continue;
    const group = groups.get(line.fp);
    if (group === undefined) groups.set(line.fp, { first: line, latest: line, seen: [line] });
    else {
      group.latest = line;
      group.seen.push(line);
    }
  }

  const windowStart = addDays(day, -(TRAILING_DAYS - 1));
  const entries = new Map<string, Entry>();
  for (const [fp, { first, latest, seen }] of groups) {
    const history = outcomes.get(fp) ?? [];
    const last = history.at(-1);
    const resolvedOn = history.findLast((o) => o.outcome === "resolved")?.day;
    const counted = seen.filter((f) => resolvedOn === undefined || f.day > resolvedOn);
    const days = new Set(counted.filter((f) => f.day >= windowStart).map((f) => f.day));

    let status: Status = "open";
    if (last?.outcome === "filed" || last?.outcome === "picked") status = "filed";
    else if (last?.outcome === "dismissed" && last.day > addDays(day, -SUPPRESS_DAYS))
      status = "suppressed";
    else if (last?.outcome === "resolved" && counted.length === 0) status = "resolved";

    entries.set(fp, {
      fp,
      latest,
      firstSeen: first.day,
      daysSeen: days.size,
      status,
      regression: resolvedOn !== undefined && counted.length > 0,
    });
  }
  return entries;
}

const IMPACT_RANK: Record<Impact, number> = { low: 0, moderate: 1, high: 2 };

function rank(a: Entry, b: Entry): number {
  if (a.daysSeen !== b.daysSeen) return b.daysSeen - a.daysSeen;
  const impact = IMPACT_RANK[b.latest.impact] - IMPACT_RANK[a.latest.impact];
  if (impact !== 0) return impact;
  return a.firstSeen.localeCompare(b.firstSeen);
}

// The daily run surfaces at most one small change for a symptom that has
// persisted, and the weekly ranks every open entry. Low impact never surfaces.
// It stays in the ledger, where growth would raise it.
export function decide(entries: Map<string, Entry>, window: Window, day: string): Decision {
  const lookback = window === "1d" ? day : addDays(day, -(TRAILING_DAYS - 1));
  const open = [...entries.values()].filter((e) => e.status === "open" && e.latest.day >= lookback);
  const visible = open.filter((e) => e.latest.impact !== "low").toSorted(rank);

  const promote =
    window === "1d"
      ? // Only a blocker seen today with a small fix is worth a mid-week change.
        visible
          .filter((e) => e.latest.day === day && e.latest.impact === "high" && e.latest.small)
          .slice(0, 1)
      : visible.slice(0, WEEKLY_TOP);
  const belowCut = visible.filter((e) => !promote.includes(e)).slice(0, BELOW_CUT);

  return {
    window,
    day,
    promote,
    belowCut,
    ledgerOnly: open.length - promote.length - belowCut.length,
  };
}

export async function recordOutcome(
  path: string,
  fp: string,
  outcome: Outcome,
  day: string,
  at: string,
  ref?: string,
): Promise<void> {
  await append(path, [{ kind: "outcome", fp, outcome, day, at, ref }]);
}

export async function record(
  path: string,
  findings: FindingInput[],
  window: Window,
  day: string,
  at: string,
): Promise<Decision> {
  const lines: FindingLine[] = findings.map((f) => ({
    kind: "finding",
    fp: fingerprint(f.type, f.target),
    day,
    at,
    ...f,
  }));
  await append(path, lines);
  const decision = decide(reduce(await readLedger(path), day), window, day);
  await append(path, [
    {
      kind: "run",
      window,
      day,
      at,
      findings: lines.length,
      promoted: decision.promote.map((e) => e.fp),
    },
  ]);
  return decision;
}

function summarize(entry: Entry) {
  const { fp, status, daysSeen, firstSeen, regression, latest } = entry;
  return {
    fp,
    status,
    daysSeen,
    firstSeen,
    regression,
    type: latest.type,
    target: latest.target,
    impact: latest.impact,
    metric: latest.metric,
    fix: latest.fix,
    small: latest.small,
  };
}

if (import.meta.main) {
  const program = new Command("ledger").description(
    "Record friction findings and decide what surfaces",
  );
  const ledgerOption = () => new Option("--ledger <path>", "ledger file").default(ledgerPath());
  const dayOption = () =>
    new Option("--day <YYYY-MM-DD>", "run day, local time").default(localDay());

  program
    .command("record")
    .description("Append findings from stdin (a JSON array) and print the run's decision")
    .addOption(new Option("--window <window>", "lookback window").choices(WINDOWS).default("1d"))
    .addOption(dayOption())
    .addOption(ledgerOption())
    .action(async (opts) => {
      const findings = z.array(FindingInput).parse(JSON.parse(await Bun.stdin.text()));
      const decision = await record(
        opts.ledger,
        findings,
        opts.window,
        opts.day,
        new Date().toISOString(),
      );
      const { promote, belowCut, ledgerOnly } = decision;
      console.log(
        JSON.stringify(
          {
            ...decision,
            promote: promote.map(summarize),
            belowCut: belowCut.map(summarize),
            ledgerOnly,
          },
          null,
          2,
        ),
      );
    });

  program
    .command("outcome")
    .description("Record what happened to a surfaced fingerprint")
    .argument("<fp>", "fingerprint")
    .addArgument(new Argument("<outcome>", "outcome").choices(OUTCOMES))
    .option("--ref <url>", "PR or to-do the outcome refers to")
    .addOption(dayOption())
    .addOption(ledgerOption())
    .action(async (fp, outcome, opts) => {
      await recordOutcome(opts.ledger, fp, outcome, opts.day, new Date().toISOString(), opts.ref);
    });

  program
    .command("status")
    .description("Print every fingerprint's state as JSON")
    .addOption(dayOption())
    .addOption(ledgerOption())
    .action(async (opts) => {
      const entries = [...reduce(await readLedger(opts.ledger), opts.day).values()].toSorted(rank);
      console.log(JSON.stringify(entries.map(summarize), null, 2));
    });

  await program.parseAsync();
}
