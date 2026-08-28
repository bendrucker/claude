import { getBorderCharacters, table } from "table";
import type { Plan } from "./plan";

// The plan block is prompt text, so the table carries no borders and the
// padding `table` adds to square each column comes back off.
function rows(pairs: [string, string | null][]): string {
  const present = pairs.flatMap(([label, value]): string[][] =>
    value === null ? [] : [[`  ${label}`, value]],
  );
  return table(present, {
    border: getBorderCharacters("void"),
    columnDefault: { paddingLeft: 0, paddingRight: 2 },
    drawHorizontalLine: () => false,
  }).replaceAll(/ +$/gm, "");
}

function section(title: string, body: string | null): string[] {
  return body === null ? [] : ["", title, body];
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join("\n");
}

export function render(plan: Plan, options: { angles: boolean }): string {
  const { cell, finderBudget, angles } = plan;
  const budget = finderBudget?.agents ?? null;

  const summary = rows([
    ["mode", plan.modeText],
    ["angles", cell.angleSet === null ? null : `${cell.angleSet} (${angles.length})`],
    [
      "candidates",
      cell.candidatesPerAngle === null ? null : `${cell.candidatesPerAngle} per angle`,
    ],
    [
      "finders",
      budget === null ? null : `${budget} agents for ${finderBudget?.diffLines} changed lines`,
    ],
    ["verify", cell.verify],
    ["sweep", cell.sweep ? "yes" : null],
    ["cap", cell.cap === null ? null : String(cell.cap)],
    ["floor", cell.floor === null ? null : String(cell.floor)],
    ["report", cell.reportsVia],
  ]);

  const audience = cell.mode === "fanout" ? "give to every angle agent" : "applies to every angle";
  const angleText =
    angles.length === 0
      ? []
      : [
          "",
          "ANGLES",
          ...angles.flatMap((angle) => [`### ${angle.name}`, "", angle.text.trim(), ""]),
        ];

  return [
    `CELL ${plan.cellName}   family ${plan.family}   level ${plan.level}`,
    "",
    summary.trimEnd(),
    ...section("FINDER BUDGET", finderBudget === null ? null : finderBudget.text.trim()),
    ...section(
      "FRAMING (emit verbatim before Phase 1)",
      plan.framing === null ? null : quote(plan.framing),
    ),
    ...section("FLOOR", plan.floorInstruction),
    ...section("INSTRUCTIONS", plan.lowInstructions),
    ...(options.angles
      ? [
          ...section(`FINDER PREAMBLE (${audience})`, plan.preamble),
          ...angleText.slice(0, -1),
          ...section("CLEANUP PRECEDENCE", plan.cleanupPrecedence),
          ...section("SWEEP GAP FOCUS", plan.sweepGapFocus),
        ]
      : []),
  ].join("\n");
}
