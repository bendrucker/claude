#!/usr/bin/env bun

import { join } from "node:path";
import { cli } from "cleye";
import { z } from "zod";

const modeSchema = z.enum(["fanout", "inline", "direct"]);
const angleSetSchema = z.enum(["core", "full"]);
const angleKindSchema = z.enum(["correctness", "cleanup", "altitude", "conventions"]);
const countSchema = z.number().int().positive();

const cellSchema = z.object({
  mode: modeSchema,
  angleSet: angleSetSchema.nullable(),
  candidatesPerAngle: countSchema.nullable(),
  verify: z.string(),
  sweep: z.boolean(),
  cap: countSchema.nullable(),
  floor: z.union([countSchema, z.string()]).nullable(),
  framing: z.string().nullable(),
  reportsVia: z.enum(["ReportFindings", "text"]),
});

const effortsSchema = z.object({
  spawnModel: z.string(),
  levels: z.array(z.string()).nonempty(),
  aliases: z.record(z.string(), z.string()),
  modes: z.record(modeSchema, z.string()),
  families: z.array(z.object({ id: z.string(), match: z.array(z.string()) })).nonempty(),
  selection: z.record(
    z.string(),
    z.record(z.string(), z.object({ cell: z.string(), modifiers: z.array(z.string()) })),
  ),
  cells: z.record(z.string(), cellSchema),
  framings: z.record(z.string(), z.string()),
  lowInstructions: z.object({ shared: z.string(), cells: z.record(z.string(), z.string()) }),
  floorInstruction: z.string(),
  finderBudget: z.object({
    linesPerAgent: countSchema,
    min: countSchema,
    max: countSchema,
    text: z.string(),
  }),
});

const angleSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: angleKindSchema,
  sets: z.array(angleSetSchema).nonempty(),
  text: z.string(),
});

const anglesSchema = z.object({
  preamble: z.string(),
  angles: z.array(angleSchema).nonempty(),
  cleanupPrecedence: z.string(),
  sweepGapFocus: z.string(),
});

export type Mode = z.infer<typeof modeSchema>;
export type AngleSet = z.infer<typeof angleSetSchema>;
export type AngleKind = z.infer<typeof angleKindSchema>;
export type Cell = z.infer<typeof cellSchema>;
export type Efforts = z.infer<typeof effortsSchema>;
export type Angle = z.infer<typeof angleSchema>;
export type Angles = z.infer<typeof anglesSchema>;

export type Plan = {
  family: string;
  level: string;
  cellName: string;
  cell: Cell;
  modifiers: string[];
  spawnModel: string;
  modeText: string;
  framing: string | null;
  floorInstruction: string | null;
  lowInstructions: string | null;
  finderBudget: { agents: number | null; diffLines: number | null; text: string } | null;
  preamble: string | null;
  angles: Angle[];
  cleanupPrecedence: string | null;
  sweepGapFocus: string | null;
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const SKILL_DIR = join(import.meta.dirname, "..");

export async function load(dir = SKILL_DIR): Promise<{ efforts: Efforts; angles: Angles }> {
  const [effortsText, anglesText] = await Promise.all([
    Bun.file(join(dir, "efforts.yaml")).text(),
    Bun.file(join(dir, "angles.yaml")).text(),
  ]);
  return {
    efforts: effortsSchema.parse(Bun.YAML.parse(effortsText)),
    angles: anglesSchema.parse(Bun.YAML.parse(anglesText)),
  };
}

// A level token resolves by unique prefix over the canonical levels plus the
// aliases, so `hi`, `hig`, and `high` all land on `high` while `mediumish`
// lands nowhere. Ambiguity is an error rather than a silent pick.
export function resolveLevel(
  token: string,
  efforts: Efforts,
): { ok: true; level: string } | { ok: false; reason: string } {
  const names = [...efforts.levels, ...Object.keys(efforts.aliases)];
  const valid = `Valid levels: ${efforts.levels.join(", ")} (${Object.keys(efforts.aliases).join(", ")}).`;
  const wanted = token.trim().toLowerCase();
  if (!/^[a-z]+$/.test(wanted)) {
    return { ok: false, reason: `"${token}" is not an effort level. ${valid}` };
  }
  const canonical = (name: string) => efforts.aliases[name] ?? name;
  const exact = names.find((name) => name === wanted);
  if (exact !== undefined) return { ok: true, level: canonical(exact) };
  const matches = names.filter((name) => name.startsWith(wanted));
  const levels = [...new Set(matches.map(canonical))];
  const [only] = levels;
  if (only !== undefined && levels.length === 1) return { ok: true, level: only };
  if (levels.length === 0) {
    return { ok: false, reason: `"${token}" is not an effort level. ${valid}` };
  }
  return { ok: false, reason: `"${token}" is ambiguous: ${levels.join(", ")}. ${valid}` };
}

// Families match on a substring of the active model id, in declaration order.
// The fallback family declares no substrings and so matches anything.
export function resolveFamily(modelId: string, efforts: Efforts): string {
  const id = modelId.trim().toLowerCase();
  const family = efforts.families.find(
    (candidate) =>
      candidate.match.length === 0 || candidate.match.some((needle) => id.includes(needle)),
  );
  if (family === undefined) throw new Error("efforts.yaml declares no fallback family.");
  return family.id;
}

export function finderAgents(diffLines: number, budget: Efforts["finderBudget"]): number {
  const scaled = Math.ceil(diffLines / budget.linesPerAgent);
  return Math.min(budget.max, Math.max(budget.min, scaled));
}

export function resolvePlan(
  efforts: Efforts,
  angles: Angles,
  options: { family: string; level: string; diffLines?: number | undefined },
): Plan {
  const selected = efforts.selection[options.family]?.[options.level];
  if (selected === undefined) {
    throw new Error(`No cell for family ${options.family} at level ${options.level}.`);
  }
  const cell = efforts.cells[selected.cell];
  if (cell === undefined) throw new Error(`efforts.yaml selects unknown cell ${selected.cell}.`);

  const set = cell.angleSet;
  const chosen = set === null ? [] : angles.angles.filter((angle) => angle.sets.includes(set));
  const hasCleanup = chosen.some((angle) => angle.kind !== "correctness");

  const framing = cell.framing === null ? null : efforts.framings[cell.framing];
  if (framing === undefined) {
    throw new Error(`efforts.yaml cell ${selected.cell} names unknown framing ${cell.framing}.`);
  }

  const lowText = efforts.lowInstructions.cells[selected.cell];
  const budget = selected.modifiers.includes("finder-budget")
    ? {
        agents:
          options.diffLines === undefined
            ? null
            : finderAgents(options.diffLines, efforts.finderBudget),
        diffLines: options.diffLines ?? null,
        text: efforts.finderBudget.text,
      }
    : null;

  return {
    family: options.family,
    level: options.level,
    cellName: selected.cell,
    cell,
    modifiers: selected.modifiers,
    spawnModel: efforts.spawnModel,
    modeText: efforts.modes[cell.mode].replace("{spawnModel}", efforts.spawnModel),
    framing: framing === null ? null : framing.trim(),
    floorInstruction:
      cell.floor === null
        ? null
        : efforts.floorInstruction.trim().replace("{floor}", String(cell.floor)),
    lowInstructions:
      cell.mode === "direct"
        ? [efforts.lowInstructions.shared, lowText ?? ""]
            .map((text) => text.trim())
            .filter((text) => text.length > 0)
            .join("\n\n")
        : null,
    finderBudget: budget,
    preamble: chosen.length > 0 ? angles.preamble.trim() : null,
    angles: chosen,
    cleanupPrecedence: hasCleanup ? angles.cleanupPrecedence.trim() : null,
    sweepGapFocus: cell.sweep ? angles.sweepGapFocus.trim() : null,
  };
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join("\n");
}

export function render(plan: Plan, options: { angles: boolean }): string {
  const { cell } = plan;
  const rows: [string, string][] = [["mode", plan.modeText]];
  if (cell.angleSet !== null) rows.push(["angles", `${cell.angleSet} (${plan.angles.length})`]);
  if (cell.candidatesPerAngle !== null) {
    rows.push(["candidates", `${cell.candidatesPerAngle} per angle`]);
  }
  if (plan.finderBudget !== null && plan.finderBudget.agents !== null) {
    rows.push([
      "finders",
      `${plan.finderBudget.agents} agents for ${plan.finderBudget.diffLines} changed lines`,
    ]);
  }
  rows.push(["verify", cell.verify]);
  if (cell.sweep) rows.push(["sweep", "yes"]);
  if (cell.cap !== null) rows.push(["cap", String(cell.cap)]);
  if (cell.floor !== null) rows.push(["floor", String(cell.floor)]);
  rows.push(["report", cell.reportsVia]);

  const width = Math.max(...rows.map(([label]) => label.length));
  const out: string[] = [
    `CELL ${plan.cellName}   family ${plan.family}   level ${plan.level}`,
    "",
    ...rows.map(([label, value]) => `  ${label.padEnd(width)}  ${value}`),
  ];

  if (plan.finderBudget !== null) out.push("", "FINDER BUDGET", plan.finderBudget.text.trim());

  if (plan.framing !== null) {
    out.push("", "FRAMING (emit verbatim before Phase 1)", quote(plan.framing));
  }

  if (plan.floorInstruction !== null) out.push("", "FLOOR", plan.floorInstruction);

  if (plan.lowInstructions !== null) {
    out.push("", "INSTRUCTIONS", plan.lowInstructions);
  }

  if (options.angles) {
    if (plan.preamble !== null) {
      const audience =
        plan.cell.mode === "fanout" ? "give to every angle agent" : "applies to every angle";
      out.push("", `FINDER PREAMBLE (${audience})`, plan.preamble);
    }

    if (plan.angles.length > 0) {
      out.push("", "ANGLES");
      for (const angle of plan.angles) out.push(`### ${angle.name}`, "", angle.text.trim(), "");
      out.pop();
    }

    if (plan.cleanupPrecedence !== null) out.push("", "CLEANUP PRECEDENCE", plan.cleanupPrecedence);
    if (plan.sweepGapFocus !== null) out.push("", "SWEEP GAP FOCUS", plan.sweepGapFocus);
  }

  return out.join("\n");
}

if (import.meta.main) {
  const argv = cli({
    name: "review-plan",
    parameters: ["[level]"],
    strictFlags: true,
    help: {
      description:
        "Resolve the review:code plan for a model and effort level: cell, caps, framing, and angle text.",
    },
    flags: {
      model: { type: String, description: "Active model id, e.g. claude-opus-5" },
      diffLines: { type: Number, description: "Changed lines in the range, for the finder budget" },
      noAngles: { type: Boolean, description: "Print the plan block only, without the angle text" },
      json: { type: Boolean, description: "Print the resolved plan as JSON" },
    },
  });

  const { efforts, angles } = await load();

  const model = argv.flags.model;
  if (model === undefined) fail("--model is required. Pass the active model id.");

  const resolved = resolveLevel(argv._.level ?? "medium", efforts);
  if (!resolved.ok) fail(resolved.reason);

  const plan = ((): Plan => {
    try {
      return resolvePlan(efforts, angles, {
        family: resolveFamily(model, efforts),
        level: resolved.level,
        diffLines: argv.flags.diffLines,
      });
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  })();

  console.log(
    argv.flags.json
      ? JSON.stringify(plan, null, 2)
      : render(plan, { angles: !argv.flags.noAngles }),
  );
}
