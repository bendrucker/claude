import { expect, test } from "bun:test";
import { join } from "node:path";
import { DecideTruth } from "./decide";
import { all, graders, loadLine, report, rounds } from "./gen-decide";

const suite = join(import.meta.dir, "..");
const cases = all();

test.each(cases.map((c) => [c.name, c] as const))(
  "committed %s matches the generator",
  async (name, c) => {
    const read = (file: string) => Bun.file(join(suite, name, file)).text();
    expect(await read("prompt.md")).toBe(c.prompt);
    const truth: unknown = await Bun.file(join(suite, name, "truth.json")).json();
    expect(DecideTruth.parse(truth)).toEqual(c.truth);
    const expected = graders(c.truth);
    const written = await Promise.all(
      Object.keys(expected).map(async (file) => [file, await read(join("graders", file))]),
    );
    expect(Object.fromEntries(written)).toEqual(expected);
  },
);

test("every trap covers three domains", () => {
  const count = (key: (c: (typeof cases)[number]) => string) => {
    const counts: Record<string, number> = {};
    for (const c of cases) counts[key(c)] = (counts[key(c)] ?? 0) + 1;
    return counts;
  };
  expect(new Set(Object.values(count((c) => c.truth.trap)))).toEqual(new Set([3]));
  expect(count((c) => c.truth.decisions.join(" or "))).toEqual({
    reject: 12,
    "reject or re-run": 3,
    "re-run": 6,
    accept: 3,
  });
});

test.each([
  ["a gain past 3% at p < 0.1 is starred", 0.9, 0.04, 18, "-10.0%*"],
  ["a gain under 3% is not", 0.98, 0.01, 18, "-2.0%"],
  ["a high p is not", 0.9, 0.2, 18, "-10.0%"],
  ["too few runs are not", 0.9, 0.01, 3, "-10.0%"],
])("report: %s", (_, ratio, p, n, cell) => {
  const arm = (name: string, median: number, runs: number) => ({
    name,
    n: runs,
    median,
    spread: 2,
    memory: 40,
    failures: 0,
  });
  expect(report(arm("base", 1, 18), arm("candidate", ratio, n), p)).toContain(`| ${cell} |`);
});

test.each([
  [false, "load: no round above 2×8 cpus"],
  [true, "load: 6 of 6 rounds above 2×8 cpus (1, 2, 3, 4, 5, 6)"],
])("loadLine with loaded=%p", (loaded, line) => {
  expect(loadLine(8, rounds(8, loaded, 4))).toStartWith(line);
});
