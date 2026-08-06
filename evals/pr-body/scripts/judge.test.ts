import { expect, test } from "bun:test";
import { join } from "node:path";
import { AXES, buildPairs } from "./judge";
import type { GenerationRow, Scenario } from "./run-eval";
import { scoreBody } from "./score";

const PROMPT_PATH = join(import.meta.dirname, "..", "judge-prompt.md");

function rubricAxes(markdown: string): string[] {
  const axes: string[] = [];
  for (const line of markdown.split("\n")) {
    const match = line.match(/^###\s+(.+)$/);
    if (match?.[1]) axes.push(match[1].trim().replace(/^`|`$/g, ""));
  }
  return axes;
}

test("the schema axes are exactly the rubric's axis headings", async () => {
  const markdown = await Bun.file(PROMPT_PATH).text();
  expect(rubricAxes(markdown)).toEqual([...AXES]);
});

function scenario(id: string): Scenario {
  return {
    id,
    url: "https://github.com/o/r/pull/1",
    title: "A title",
    repo: "o/r",
    tier: "personal",
    diffSummary: "A change.",
    substance: [],
    originalBody: "A body.",
  };
}

function generation(scenarioId: string, arm: GenerationRow["arm"], seed: number): GenerationRow {
  return {
    scenarioId,
    arm,
    seed,
    model: null,
    title: `${arm} ${seed}`,
    body: "A body.",
    score: scoreBody("A body."),
    usage: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 },
  };
}

test("buildPairs groups a scenario's arms by seed", () => {
  const pairs = buildPairs(
    [scenario("001-alpha-1"), scenario("002-beta-2")],
    [
      generation("001-alpha-1", "a", 1),
      generation("001-alpha-1", "b", 1),
      generation("002-beta-2", "a", 1),
      generation("002-beta-2", "b", 1),
      generation("002-beta-2", "a", 2),
      generation("001-alpha-1", "original", 0),
    ],
  );
  expect(pairs.map((pair) => [pair.scenario.id, pair.seed])).toEqual([
    ["001-alpha-1", 1],
    ["002-beta-2", 1],
  ]);
  expect(pairs[0]?.rows.a.title).toBe("a 1");
  expect(pairs[0]?.rows.b.title).toBe("b 1");
});
