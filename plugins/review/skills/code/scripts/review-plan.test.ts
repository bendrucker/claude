import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import anglesSchema from "../angles.schema.json";
import effortsSchema from "../efforts.schema.json";
import {
  finderAgents,
  load,
  render,
  resolveFamily,
  resolveLevel,
  resolvePlan,
} from "./review-plan";

const SKILL_DIR = join(import.meta.dirname, "..");
const { efforts, angles } = await load(SKILL_DIR);

const pairs = Object.keys(efforts.selection).flatMap((family) =>
  efforts.levels.map((level) => [family, level] as const),
);

test.each(pairs)("renders the %s / %s plan", (family, level) => {
  expect(
    render(resolvePlan(efforts, angles, { family, level }), { angles: true }),
  ).toMatchSnapshot();
});

describe("level tokens", () => {
  test.each([
    ["low", "low"],
    ["Med", "medium"],
    ["hi", "high"],
    ["xh", "xhigh"],
    ["max", "xhigh"],
    ["medium", "medium"],
  ])("%s resolves to %s", (token, level) => {
    expect(resolveLevel(token, efforts)).toEqual({ ok: true, level });
  });

  test.each(["mediumish", "m", "", "3", "xhigh!"])("%p does not resolve", (token) => {
    const result = resolveLevel(token, efforts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("low, medium, high, xhigh");
  });
});

test.each([
  ["claude-sonnet-5", "claude-sonnet-5"],
  ["claude-opus-4-8", "claude-opus-4-8"],
  ["claude-fable-5", "claude-fable-5"],
  ["claude-opus-5[1m]", "default"],
  ["some-other-model", "default"],
])("%s belongs to the %s family", (model, family) => {
  expect(resolveFamily(model, efforts)).toBe(family);
});

describe("schemas", () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });

  test.each([
    ["efforts", effortsSchema, efforts],
    ["angles", anglesSchema, angles],
  ])("%s.yaml validates against its schema", (_, schema, data) => {
    const validate = ajv.compile(schema);
    expect(validate(data) ? [] : validate.errors).toEqual([]);
  });
});

describe("cross-file invariants", () => {
  const selections = Object.entries(efforts.selection).flatMap(([family, levels]) =>
    Object.entries(levels).map(([level, selected]) => ({
      family,
      level,
      cell: selected.cell,
      modifiers: selected.modifiers,
    })),
  );

  test.each(selections)("$family/$level selects a declared cell", ({ cell }) => {
    expect(Object.keys(efforts.cells)).toContain(cell);
  });

  test.each(Object.entries(efforts.cells))("cell %s resolves its angles and framing", (_, cell) => {
    const set = cell.angleSet;
    if (set !== null) {
      expect(angles.angles.filter((angle) => angle.sets.includes(set))).not.toBeEmpty();
    }
    if (cell.framing !== null) expect(efforts.framings).toHaveProperty(cell.framing);
  });

  test("every cell is reachable from some family and level", () => {
    const selected = new Set(selections.map((entry) => entry.cell));
    expect([...selected].toSorted()).toEqual(Object.keys(efforts.cells).toSorted());
  });

  test("every direct cell carries its own low instructions", () => {
    const direct = Object.entries(efforts.cells)
      .filter(([, cell]) => cell.mode === "direct")
      .map(([name]) => name);
    expect(direct.toSorted()).toEqual(Object.keys(efforts.lowInstructions.cells).toSorted());
  });

  test.each(selections.filter(({ cell }) => efforts.cells[cell]?.floor !== null))(
    "$family/$level renders its floor with the instruction not to pad",
    ({ family, level, cell }) => {
      const output = render(resolvePlan(efforts, angles, { family, level }), { angles: false });
      expect(output).toContain(`Target at least ${efforts.cells[cell]?.floor} findings`);
    },
  );

  test("an unresolvable family reports what is missing", () => {
    expect(() => resolvePlan(efforts, angles, { family: "nope", level: "medium" })).toThrow(
      "No cell for family nope at level medium.",
    );
  });

  test("an exact level name beats a longer prefix match", () => {
    const shadowed = { ...efforts, aliases: { ...efforts.aliases, highest: "xhigh" } };
    expect(resolveLevel("high", shadowed)).toEqual({ ok: true, level: "high" });
  });

  test("core is a subset of full", () => {
    const core = angles.angles.filter((angle) => angle.sets.includes("core"));
    expect(core.every((angle) => angle.sets.includes("full"))).toBe(true);
  });
});

describe("finder budget", () => {
  test.each([
    [0, 2],
    [150, 2],
    [300, 2],
    [450, 3],
    [900, 6],
    [1200, 8],
    [5000, 8],
  ])("%i changed lines needs %i agents", (lines, agents) => {
    expect(finderAgents(lines, efforts.finderBudget)).toBe(agents);
  });

  test.each([
    ["claude-sonnet-5", 900, 6],
    ["default", 900, null],
  ])("%s at high reports %i lines as %p agents", (family, diffLines, agents) => {
    const plan = resolvePlan(efforts, angles, { family, level: "high", diffLines });
    expect(plan.finderBudget?.agents ?? null).toBe(agents);
  });
});

test("--no-angles drops the angle text but keeps the plan", () => {
  const plan = resolvePlan(efforts, angles, { family: "default", level: "xhigh" });
  const output = render(plan, { angles: false });
  expect(output).toContain("CELL xhigh");
  expect(output).not.toContain("ANGLES");
});
