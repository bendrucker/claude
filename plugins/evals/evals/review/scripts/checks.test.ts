import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Heading, List, ListItem, Paragraph, Root, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";

const plugin = join(import.meta.dir, "../../..");

interface Check {
  name: string;
  sections: string[];
  sentences: string[];
}

const squash = (text: string): string => text.replaceAll(/\s+/g, " ").trim();

const isHeading = (node: RootContent): node is Heading => node.type === "heading";
const isList = (node: RootContent): node is List => node.type === "list";
const isParagraph = (node: RootContent): node is Paragraph => node.type === "paragraph";

/** Sentences of a block of plain text. */
export function sentences(text: string): string[] {
  return squash(text)
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s !== "");
}

/** The plain text under each heading, which runs until the next heading of the same or higher level. */
export function sections(tree: Root): Map<string, string> {
  const out = new Map<string, string>();
  for (const [i, node] of tree.children.entries()) {
    if (!isHeading(node)) continue;
    const rest = tree.children.slice(i + 1);
    const end = rest.findIndex((n) => isHeading(n) && n.depth <= node.depth);
    const body = end === -1 ? rest : rest.slice(0, end);
    out.set(toString(node), body.map((n) => toString(n)).join("\n"));
  }
  return out;
}

function parseItem(item: ListItem): Check {
  const lead = item.children.find(isParagraph);
  if (lead === undefined) throw new Error("a check has no leading paragraph");
  const text = squash(toString(lead));
  const match = /^(.+?) \(([^)]+)\)\. (.*)$/.exec(text);
  if (match === null) throw new Error(`a check lacks "Name (Section). ..." in: ${text}`);
  const [, name = "", named = "", rest = ""] = match;
  return {
    name,
    sections: named.split(",").map((s) => s.trim()),
    sentences: sentences(rest),
  };
}

/** The checks under `## Checks`: each top-level list item, with nested lists left out. */
export function checks(tree: Root): Check[] {
  const at = tree.children.findIndex(
    (n) => isHeading(n) && n.depth === 2 && toString(n) === "Checks",
  );
  if (at === -1) throw new Error("no ## Checks heading");
  const rest = tree.children.slice(at + 1);
  const end = rest.findIndex((n) => isHeading(n) && n.depth <= 2);
  const list = (end === -1 ? rest : rest.slice(0, end)).find(isList);
  if (list === undefined) throw new Error("## Checks holds no list");
  return list.children.map(parseItem);
}

/** Why a check's quotes drift from the skill, or an empty list when every sentence is verbatim. */
export function drift(check: Check, skill: Map<string, string>): string[] {
  const problems: string[] = [];
  if (check.sentences.length === 0) problems.push("no sentences");
  const known = check.sections.filter((s) => skill.has(s));
  for (const s of check.sections) if (!skill.has(s)) problems.push(`no SKILL.md section "${s}"`);
  if (known.length === 0) problems.push("no named section exists");
  const bodies = known.map((s) => squash(skill.get(s) ?? ""));
  for (const sentence of check.sentences)
    if (!bodies.some((b) => b.includes(sentence)))
      problems.push(`not verbatim under ${check.sections.join(", ")}: ${sentence}`);
  return problems;
}

const parse = async (path: string): Promise<Root> => fromMarkdown(await Bun.file(path).text());

const agent = checks(await parse(join(plugin, "agents/review.md")));
const skill = sections(await parse(join(plugin, "skills/hill-climb/SKILL.md")));

describe("each check quotes the skill", () => {
  test("the agent lists checks", () => {
    expect(agent.length).toBeGreaterThan(0);
  });

  test.each(agent.map((c) => [c.name, c] as const))("%s", (_, check) => {
    expect(drift(check, skill)).toEqual([]);
  });
});

describe("the parsing", () => {
  const doc = (text: string) => fromMarkdown(text);

  test("a check's name, sections, and sentences come from its leading paragraph", () => {
    const tree = doc(
      [
        "## Checks",
        "",
        "- **Pre-registration** (Candidate, Compare). Say `A` first. It is a **result**.",
        "  - an audit-only line.",
        "",
      ].join("\n"),
    );
    expect(checks(tree)).toEqual([
      {
        name: "Pre-registration",
        sections: ["Candidate", "Compare"],
        sentences: ["Say A first.", "It is a result."],
      },
    ]);
  });

  test("a section runs to the next heading of the same or higher level", () => {
    const map = sections(doc("## A\n\none\n\n### B\n\ntwo\n\n## C\n\nthree\n"));
    expect(map.get("A")).toContain("two");
    expect(map.get("B")).not.toContain("three");
    expect(map.get("A")).not.toContain("three");
  });

  const skillText = sections(doc("#### Compare\n\nA cell needs `4` runs a side to star.\n"));
  const check = (sentence: string): Check => ({
    name: "Noise",
    sections: ["Compare"],
    sentences: [sentence],
  });

  test("a verbatim sentence passes whatever the markup", () => {
    expect(drift(check("A cell needs 4 runs a side to star."), skillText)).toEqual([]);
  });

  test("a sentence altered by one word is named", () => {
    expect(drift(check("A cell needs 4 runs per side to star."), skillText)).toHaveLength(1);
  });

  test("a missing section, or none at all, fails", () => {
    const missing = { name: "Noise", sections: ["Nowhere"], sentences: ["x."] };
    expect(drift(missing, skillText).length).toBeGreaterThan(0);
    expect(drift({ ...check("x."), sentences: [] }, skillText)).toContain("no sentences");
  });
});
