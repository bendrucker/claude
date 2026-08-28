import { join } from "node:path";
import { anglesIn, anglesSchema, type Angle, type Angles } from "./angles";
import { effortsSchema, finderAgents, type Cell, type Efforts } from "./efforts";

export type FinderBudget = { agents: number | null; diffLines: number | null; text: string };

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
  finderBudget: FinderBudget | null;
  preamble: string | null;
  angles: Angle[];
  cleanupPrecedence: string | null;
  sweepGapFocus: string | null;
};

const SKILL_DIR = join(import.meta.dirname, "..");

export async function load(dir = SKILL_DIR): Promise<{ efforts: Efforts; angles: Angles }> {
  const read = (name: string) => Bun.file(join(dir, `${name}.yaml`)).text();
  const [efforts, angles] = await Promise.all([read("efforts"), read("angles")]);
  return {
    efforts: effortsSchema.parse(Bun.YAML.parse(efforts)),
    angles: anglesSchema.parse(Bun.YAML.parse(angles)),
  };
}

export function resolvePlan(
  efforts: Efforts,
  angles: Angles,
  options: { family: string; level: string; diffLines?: number | undefined },
): Plan {
  const { cells, framings, lowInstructions, modes, spawnModel, floorInstruction } = efforts;
  const { family, level, diffLines } = options;

  const selected = efforts.selection[family]?.[level];
  if (selected === undefined) throw new Error(`No cell for family ${family} at level ${level}.`);
  const cell = cells[selected.cell];
  if (cell === undefined) throw new Error(`efforts.yaml selects unknown cell ${selected.cell}.`);

  const framing = cell.framing === null ? null : framings[cell.framing];
  if (framing === undefined) {
    throw new Error(`efforts.yaml cell ${selected.cell} names unknown framing ${cell.framing}.`);
  }

  const chosen = anglesIn(angles, cell.angleSet);
  const direct = [lowInstructions.shared, lowInstructions.cells[selected.cell] ?? ""]
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .join("\n\n");

  return {
    family,
    level,
    cellName: selected.cell,
    cell,
    modifiers: selected.modifiers,
    spawnModel,
    modeText: modes[cell.mode].replace("{spawnModel}", spawnModel),
    framing: framing === null ? null : framing.trim(),
    floorInstruction:
      cell.floor === null ? null : floorInstruction.trim().replace("{floor}", String(cell.floor)),
    lowInstructions: cell.mode === "direct" ? direct : null,
    finderBudget: selected.modifiers.includes("finder-budget")
      ? {
          agents: diffLines === undefined ? null : finderAgents(diffLines, efforts.finderBudget),
          diffLines: diffLines ?? null,
          text: efforts.finderBudget.text,
        }
      : null,
    preamble: chosen.length > 0 ? angles.preamble.trim() : null,
    angles: chosen,
    cleanupPrecedence: chosen.some((angle) => angle.kind !== "correctness")
      ? angles.cleanupPrecedence.trim()
      : null,
    sweepGapFocus: cell.sweep ? angles.sweepGapFocus.trim() : null,
  };
}
