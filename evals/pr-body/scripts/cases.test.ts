import { expect, test } from "bun:test";
import { join } from "node:path";
import { loadScenarios, type Scenario } from "./run-eval";
import { branchName, renderCases, renderSubstance, toCase } from "./cases";

const dir = join(import.meta.dirname, "..");

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: "001-claude-1127",
    url: "https://github.com/bendrucker/claude/pull/1127",
    title: "session-limit: drop the hardcoded rate-limits path",
    repo: "bendrucker/claude",
    tier: "personal",
    diffSummary: "  Removes a default path. 3 files changed, +37/-8.  ",
    substance: ["The path exposed a private setup.", "Behavior is unchanged in practice."],
    originalBody: "the shipped body",
    ...overrides,
  };
}

test.each<{ name: string; title: string; expected: string }>([
  {
    name: "drops the subject prefix",
    title: "session-limit: drop the hardcoded rate-limits path",
    expected: "drop-the-hardcoded-rate-limits-path",
  },
  {
    name: "keeps a multi-area prefix out of the slug",
    title: "github,pull-request: support GitHub stacked pull requests",
    expected: "support-github-stacked-pull-requests",
  },
  {
    name: "keeps a title that has no subject prefix",
    title: "Fix the thing",
    expected: "fix-the-thing",
  },
  {
    name: "keeps a prefix containing spaces, which is prose rather than a subject",
    title: "the problem: it broke",
    expected: "the-problem-it-broke",
  },
  {
    name: "stops at a word boundary past the length budget",
    title: "job: focus a live session's herdr pane in the workspace immediately",
    expected: "focus-a-live-session-s-herdr-pane-in-the",
  },
  {
    name: "keeps a single oversized word rather than emitting nothing",
    title: "x: supercalifragilisticexpialidociousandthensome",
    expected: "supercalifragilisticexpialidociousandthensome",
  },
])("branchName $name", ({ title, expected }) => {
  expect(branchName(title)).toBe(expected);
});

test("renderSubstance falls back when a scenario records nothing", () => {
  expect(renderSubstance([])).toBe("(none recorded)");
});

test("toCase carries the scenario into vars and metadata", () => {
  expect(toCase(makeScenario())).toMatchInlineSnapshot(`
    {
      "description": "001-claude-1127",
      "metadata": {
        "scenarioId": "001-claude-1127",
        "url": "https://github.com/bendrucker/claude/pull/1127",
      },
      "vars": {
        "base": "main",
        "branch": "drop-the-hardcoded-rate-limits-path",
        "diffSummary": "Removes a default path. 3 files changed, +37/-8.",
        "repo": "bendrucker/claude",
        "substance": 
    "- The path exposed a private setup.
    - Behavior is unchanged in practice."
    ,
        "tier": "personal",
      },
    }
  `);
});

test("the shipped body never reaches a case, so no arm can copy it", () => {
  const rendered = renderCases([makeScenario()]);
  expect(rendered).not.toContain("the shipped body");
});

test("cases.json matches scenarios/", async () => {
  const rendered = renderCases(await loadScenarios(join(dir, "scenarios")));
  expect(await Bun.file(join(dir, "cases.json")).text()).toBe(rendered);
});
