import { z } from "zod";

const count = z.number().int().positive();
const key = z.string().regex(/^[a-z][a-z0-9-]*$/);

export const modeSchema = z.enum(["fanout", "inline", "direct"]);
export const angleSetSchema = z.enum(["core", "full"]);

export const cellSchema = z.strictObject({
  mode: modeSchema,
  angleSet: angleSetSchema.nullable().describe("Null on the direct cells, which run no angles."),
  candidatesPerAngle: count.nullable(),
  verify: z.string(),
  sweep: z.boolean(),
  cap: count
    .nullable()
    .describe("Maximum findings reported. Null where the cell sets only a floor."),
  floor: z
    .union([count, z.string()])
    .nullable()
    .describe("Target minimum, either a count or an expression such as min(files_changed, 4)."),
  framing: key
    .nullable()
    .describe("Key into framings. Null on the low cells, whose instructions carry their own."),
  reportsVia: z.enum(["ReportFindings", "text"]),
});

export const effortsSchema = z
  .strictObject({
    spawnModel: z
      .string()
      .describe("Model every fan-out spawn pins, substituted for {spawnModel}."),
    levels: z
      .array(z.string())
      .nonempty()
      .describe("Canonical effort levels, weakest first. A CLI token resolves by unique prefix."),
    aliases: z.record(key, z.string()).describe("Extra spellings resolving to a canonical level."),
    modes: z.record(modeSchema, z.string()).describe("One line on how each mode runs its angles."),
    families: z
      .array(z.strictObject({ id: key, match: z.array(z.string()) }))
      .nonempty()
      .describe("Families in match order. The entry with no match strings is the fallback."),
    selection: z
      .record(
        key,
        z.record(z.string(), z.strictObject({ cell: z.string(), modifiers: z.array(z.string()) })),
      )
      .describe("family id -> level -> the cell that pair runs."),
    cells: z.record(z.string(), cellSchema),
    framings: z
      .record(key, z.string())
      .describe("Framing paragraphs, emitted before the find phase."),
    lowInstructions: z.strictObject({
      shared: z.string(),
      cells: z.record(z.string(), z.string()).describe("Where the direct cells differ."),
    }),
    floorInstruction: z.string().describe("Emitted on any cell with a floor. {floor} is replaced."),
    finderBudget: z
      .strictObject({ linesPerAgent: count, min: count, max: count, text: z.string() })
      .describe("clamp(ceil(lines / linesPerAgent), min, max), on finder-budget cells."),
  })
  .meta({
    title: "Review effort cells",
    description:
      "Cell selection, budgets, and framing for review:code, served by scripts/review-plan.ts.",
  });

export type Mode = z.infer<typeof modeSchema>;
export type AngleSet = z.infer<typeof angleSetSchema>;
export type Cell = z.infer<typeof cellSchema>;
export type Efforts = z.infer<typeof effortsSchema>;

// A level token resolves by unique prefix over the canonical levels plus the
// aliases, so `hi`, `hig`, and `high` all land on `high` while `mediumish`
// lands nowhere. Ambiguity is an error rather than a silent pick.
export function resolveLevel(
  token: string,
  { levels, aliases }: Efforts,
): { ok: true; level: string } | { ok: false; reason: string } {
  const canonical = (name: string) => aliases[name] ?? name;
  const names = [...levels, ...Object.keys(aliases)];
  const valid = `Valid levels: ${levels.join(", ")} (${Object.keys(aliases).join(", ")}).`;
  const wanted = token.trim().toLowerCase();
  const unknown = { ok: false, reason: `"${token}" is not an effort level. ${valid}` } as const;

  if (!/^[a-z]+$/.test(wanted)) return unknown;
  const exact = names.find((name) => name === wanted);
  if (exact !== undefined) return { ok: true, level: canonical(exact) };

  const matched = [...new Set(names.filter((name) => name.startsWith(wanted)).map(canonical))];
  const [only] = matched;
  if (only !== undefined && matched.length === 1) return { ok: true, level: only };
  if (matched.length === 0) return unknown;
  return { ok: false, reason: `"${token}" is ambiguous: ${matched.join(", ")}. ${valid}` };
}

// Families match on a substring of the active model id, in declaration order.
// The fallback family declares no substrings and so matches anything.
export function resolveFamily(modelId: string, { families }: Efforts): string {
  const id = modelId.trim().toLowerCase();
  const family = families.find(
    ({ match }) => match.length === 0 || match.some((needle) => id.includes(needle)),
  );
  if (family === undefined) throw new Error("efforts.yaml declares no fallback family.");
  return family.id;
}

export function finderAgents(
  diffLines: number,
  { linesPerAgent, min, max }: Efforts["finderBudget"],
): number {
  return Math.min(max, Math.max(min, Math.ceil(diffLines / linesPerAgent)));
}
