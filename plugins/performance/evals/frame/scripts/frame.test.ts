import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { FrameTruth, notesFromTrace, scoreFrame, section, units } from "./frame";

const suite = join(import.meta.dir, "..");
const truth = FrameTruth.parse(await Bun.file(join(suite, "docsync", "truth.json")).json());
const example = async (file: string) =>
  (await Bun.file(join(suite, "examples", "docsync", file)).text()).replace(
    /^---\n[\s\S]*?\n---\n/,
    "",
  );
const passNotes = await example("pass/bench/CLIMB.md");
const passReply = await example("pass.md");
const benchNotes = await example("bench-as-metric/bench/CLIMB.md");
const noPluginNotes = await example("no-plugin/bench/CLIMB.md");
const noPluginReply = await example("no-plugin.md");

const rules = (...lines: string[]) => `# Climb\n\n## Rules\n\n${lines.join("\n")}\n`;
const allAssumed = rules(
  "- Ceiling: assumed: 30s.",
  "- Fast signal: assumed: phase timings.",
  "- Guard: assumed: diff -r of the tree.",
  "- Side effects: assumed: local mirror.",
  "- Scope: assumed: code only.",
  "  - Parallelism: assumed: in scope.",
  "- Inputs: assumed: 4.2.0 dev, 4.1.0 holdout.",
  "- Budget: assumed: one day.",
);

describe("units", () => {
  test.each([
    ["paragraphs", "a\nb\n\nc", ["a\nb", "c"]],
    ["top-level items keep nested ones", "- a\n  - b\n- c", ["- a\n  - b", "- c"]],
    ["headings stand alone", "## Rules\n- a", ["## Rules", "- a"]],
    ["table rows", "| a | b |\n| c | d |", ["| a | b |", "| c | d |"]],
  ])("%s", (_, text, expected) => {
    expect(units(text)).toEqual(expected);
  });
});

test.each([
  ["a subsection stays inside", "## Rules\na\n### Sub\nb\n## Next\nc", "a\n### Sub\nb"],
  ["runs to the end", "## Rules\na", "a"],
  ["a missing heading", "## Other\na", ""],
])("section: %s", (_, text, expected) => {
  expect(section(text, /\brules\b/i)).toBe(expected);
});

describe("scoreFrame", () => {
  test.each<{
    name: string;
    reply?: string;
    notes: string | undefined;
    checks: Partial<Record<string, boolean>>;
    assumed: number;
    checkpoint: boolean;
  }>([
    {
      name: "the pass example",
      reply: passReply,
      notes: passNotes,
      checks: { mismatch: true, waits: true, "time-split": true, parallelism: true },
      assumed: 1,
      checkpoint: true,
    },
    {
      name: "a Frame that adopts the bench as the metric",
      notes: benchNotes,
      checks: { mismatch: false, waits: false, "time-split": false, parallelism: false },
      assumed: 0,
      checkpoint: false,
    },
    {
      name: "a recorded no-plugin run with a nested time split and Checkpoint subheadings",
      reply: noPluginReply,
      notes: noPluginNotes,
      checks: { mismatch: true, waits: false, "time-split": true, parallelism: false },
      assumed: 0,
      checkpoint: true,
    },
    {
      name: "the mismatch flagged only in the reply",
      reply:
        "The bench fixture's lockfile already matches, so it skips fetch and apply. Real syncs take 133.6s.",
      notes: benchNotes,
      checks: { mismatch: true, "time-split": true },
      assumed: 0,
      checkpoint: false,
    },
    {
      name: "a pinned fixture named beside the release",
      notes: rules("- Inputs: the bench fixture is pinned to release 4.2.0 and fetches offline."),
      checks: { mismatch: false },
      assumed: 0,
      checkpoint: false,
    },
    {
      name: "parallelism named only in the Checkpoint",
      notes: `${rules("- Scope: code.")}\n## Checkpoint\n\n1. Parallel fetch.\n`,
      checks: { parallelism: false },
      assumed: 0,
      checkpoint: true,
    },
    {
      name: "every unsettled item marked assumed",
      notes: allAssumed,
      checks: { parallelism: true },
      assumed: 1,
      checkpoint: false,
    },
    {
      name: "a marker wrapped before its colon counts, a trailing aside does not",
      notes: rules(
        "- **Ceiling** (assumed): 30s.",
        "- Budget **assumed**: one day.",
        "- Guard: diff -r of the tree (assumed).",
      ),
      checks: {},
      assumed: 2 / 8,
      checkpoint: false,
    },
    {
      name: "no notes file",
      reply: "Stopped.",
      notes: undefined,
      checks: { mismatch: false, parallelism: false },
      assumed: 0,
      checkpoint: false,
    },
  ])("$name", ({ reply = "", notes, checks, assumed, checkpoint }) => {
    const score = scoreFrame(reply, notes, truth);
    expect(score.checks).toMatchObject(checks);
    expect(score.assumed).toBeCloseTo(assumed);
    expect(score.checkpoint).toBe(checkpoint);
  });

  test("composite averages the checks, the checkpoint, and the assumed share", () => {
    expect(scoreFrame(passReply, passNotes, truth).composite).toBe(1);
    expect(scoreFrame("", benchNotes, truth).composite).toBe(0);
  });
});

test("notesFromTrace replays writes and edits to the notes file only", () => {
  const use = (name: string, input: Record<string, unknown>) =>
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name, input }] },
    });
  const trace = [
    JSON.stringify({ type: "system" }),
    use("Write", { file_path: "/w/bench/CLIMB.md", content: "a b a" }),
    use("Write", { file_path: "/w/notes.md", content: "other" }),
    use("Edit", { file_path: "/w/bench/CLIMB.md", old_string: "b", new_string: "c" }),
    use("Edit", {
      file_path: "/w/bench/CLIMB.md",
      old_string: "a",
      new_string: "d",
      replace_all: true,
    }),
  ].join("\n");
  expect(notesFromTrace(trace, "bench/CLIMB.md")).toBe("d c d");
  expect(notesFromTrace(trace, "tmp/climb.md")).toBeUndefined();
});
