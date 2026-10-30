import { describe, expect, test } from "bun:test";
import { ARMS } from "./block";
import { all, type Compared, compared, comparedScores, type Evidence } from "./evidence";
import { renderBlock } from "./renderers";
import { prompt } from "./prompt";

const cases = all();

const starred = (rows: Compared[]) => rows.filter((r) => r.mark === "*");

/** Grader and measure rows of the dev block that star, as `<case>/<arm>/<name>`. */
function devStars(e: Evidence): string[] {
  return starred(compared(e.dev)).map((r) => r.key);
}

const target = (e: Evidence) =>
  `${e.domain.target_grader.case}/with/${e.domain.target_grader.grader}`;
const control = (e: Evidence) =>
  `${e.domain.target_grader.case}/without/${e.domain.target_grader.grader}`;
const ref = (r: { case: string; grader: string }, arm: string) => `${r.case}/${arm}/${r.grader}`;

const expectedStars: Record<string, (e: Evidence) => string[]> = {
  "control-star": (e) => [target(e), control(e)],
  underpowered: () => [],
  "off-target": (e) => [ref(e.domain.other, "with")],
  "guard-drop": (e) => [target(e), ref(e.domain.guards[0] ?? e.domain.other, "with")],
  "holdout-fell": (e) => [target(e)],
  "quota-void": (e) => [target(e)],
  "second-null": () => [],
  saturated: () => [],
  "efficiency-unregistered": (e) =>
    e.dev.cases.flatMap((c) => [`${c.id}/with/seconds`, `${c.id}/with/cost`]),
  "version-drift": (e) => [target(e)],
  "clean-accept": (e) => [target(e)],
};

describe("the planted stars", () => {
  test.each(cases.map((c) => [c.name, c] as const))("%s", (_, e) => {
    const expected = expectedStars[e.trap.id]?.(e) ?? [];
    expect(devStars(e).toSorted()).toEqual(expected.toSorted());
  });

  test("an underpowered target is marked † on both sides and never starred", () => {
    const e = cases.find((c) => c.trap.id === "underpowered");
    if (e === undefined) throw new Error("no underpowered case");
    const rows = compared(e.dev);
    expect(rows.every((r) => r.mark === "†")).toBe(true);
    expect(e.dev.cases.every((c) => ARMS.every((a) => c.cand[a].runs < 4))).toBe(true);
  });

  test("a quota-void case loses candidate runs on the starred case", () => {
    const e = cases.find((c) => c.trap.id === "quota-void");
    if (e === undefined) throw new Error("no quota-void case");
    const lost = e.dev.cases.filter((c) => c.errored > 0).map((c) => c.id);
    expect(lost).toContain(e.domain.target_grader.case);
  });

  test("a version-drift case differs in version or model and no other case does", () => {
    for (const e of cases) {
      const same = JSON.stringify(e.baseVersion) === JSON.stringify(e.candVersion);
      expect(same).toBe(e.trap.id !== "version-drift");
    }
  });

  test("the holdout falls only where the trap says so", () => {
    for (const e of cases) {
      const down =
        e.holdout === undefined ? [] : starred(compared(e.holdout)).filter((r) => r.cand < r.base);
      expect(down.length > 0).toBe(e.trap.id === "holdout-fell");
      expect(e.holdout !== undefined).toBe(["holdout-fell", "clean-accept"].includes(e.trap.id));
    }
  });

  test("a saturated case has every dev grader at ceiling on both arms", () => {
    const e = cases.find((c) => c.trap.id === "saturated");
    if (e === undefined) throw new Error("no saturated case");
    for (const c of e.dev.cases)
      for (const arm of ARMS)
        for (const side of [c.base[arm], c.cand[arm]])
          expect(Object.values(side.passes).every((p) => p === side.runs)).toBe(true);
    expect(comparedScores(e.dev).every((r) => r.base === 1 && r.cand === 1)).toBe(true);
  });
});

describe("every harness presents the same evidence", () => {
  test.each(cases.map((c) => [c.name, c] as const))("%s", (_, e) => {
    const csv = renderBlock({ ...e, harness: "csv" }, e.dev, ["a", "b"]);
    const pydantic = renderBlock({ ...e, harness: "pydantic" }, e.dev, ["a", "b"]);
    const native = renderBlock({ ...e, harness: "native" }, e.dev, ["a", "b"]);
    for (const c of e.dev.cases) {
      for (const arm of ARMS) {
        for (const g of c.graders) {
          expect(csv).toContain(
            `${c.id},${arm},${g},${c.base[arm].runs},${c.base[arm].passes[g]}\n`,
          );
          expect(csv).toContain(
            `${c.id},${arm},${g},${c.cand[arm].runs},${c.cand[arm].passes[g]}\n`,
          );
        }
      }
    }
    for (const r of compared(e.dev)) {
      const [caseId, arm, name] = r.key.split("/");
      expect(csv).toContain(`${caseId},${arm},${name},${r.p.toFixed(3)}\n`);
      if (r.mark === "*") expect(native).toContain(String.raw`(p=${r.p.toFixed(3)})\*`);
    }
    expect(pydantic).toContain("Evaluation Diff: base → candidate");
    for (const r of compared(e.dev).filter(
      (x) => x.mark === "*" && x.key.split("/")[2] !== "seconds",
    ))
      expect(pydantic).toContain(`p=${r.p.toFixed(3)}`);
  });

  test("the prompt carries the same log whatever the harness", () => {
    const e = cases[0];
    if (e === undefined) throw new Error("no cases");
    const log = (h: "native" | "csv") => {
      const text = prompt({ ...e, harness: h });
      return text.slice(text.indexOf("## Columns"), text.indexOf("## Dev comparison"));
    };
    expect(log("csv")).toBe(log("native"));
  });
});
