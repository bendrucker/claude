import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CorpusFlags,
  corpusHeader,
  corpusHeaderLines,
  selectCorpora,
} from "./corpus-selection";

const NO_FLAGS: CorpusFlags = {
  baseline: [],
  kind: [],
  dataDir: undefined,
  study: undefined,
  studyFilter: undefined,
};

function document(source: string, body: string): string {
  return `===== ${source} (2026-01-01) =====\n${body}\n`;
}

// A data dir holding one study corpus and the two registers the defaults name.
async function makeDataDir(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "corpus-selection-"));
  await Bun.write(
    join(dir, "contrast-baseline", "claude-deliverables.txt"),
    document("session-a", "a message on a command line") +
      document("repo/docs/guide.md", "prose committed for another reader") +
      document("repo/tmp/notes.md", "scratch"),
  );
  await Bun.write(join(dir, "voice-baseline", "github-prs.txt"), document("pr/1", "pull request"));
  await Bun.write(join(dir, "voice-baseline", "github-issues.txt"), document("i/1", "issue"));
  await Bun.write(join(dir, "voice-baseline", "sent-mail.txt"), document("m/1", "mail"));
  return dir;
}

async function withDataDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await makeDataDir();
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("selectCorpora", () => {
  test("defaults to the contrast corpus and the two shipped registers", async () => {
    await withDataDir(async (dataDir) => {
      const { study, baseline, registers } = await selectCorpora({ ...NO_FLAGS, dataDir });
      expect(study.path).toEndWith("/contrast-baseline/claude-deliverables.txt");
      expect(study.documents).toHaveLength(3);
      expect(baseline.names).toEqual(["github-prs.txt", "github-issues.txt"]);
      expect(baseline.documents).toHaveLength(2);
      // Every register on disk, so a caller can score the unspent ones as controls.
      expect(registers.map((path) => path.split("/").pop())).toEqual([
        "github-issues.txt",
        "github-prs.txt",
        "sent-mail.txt",
      ]);
    });
  });

  test("keeps only the named kinds", async () => {
    await withDataDir(async (dataDir) => {
      const { study } = await selectCorpora({ ...NO_FLAGS, dataDir, kind: ["message", "docs"] });
      expect(study.kinds).toEqual(["message", "docs"]);
      expect(study.documents.map((doc) => doc.source)).toEqual(["session-a", "repo/docs/guide.md"]);
    });
  });

  test("narrows the kinds further by source regex", async () => {
    await withDataDir(async (dataDir) => {
      const { study } = await selectCorpora({ ...NO_FLAGS, dataDir, studyFilter: "guide" });
      expect(study.documents.map((doc) => doc.source)).toEqual(["repo/docs/guide.md"]);
    });
  });

  test("scores a register named twice only once", async () => {
    await withDataDir(async (dataDir) => {
      const { baseline } = await selectCorpora({
        ...NO_FLAGS,
        dataDir,
        baseline: ["github-prs.txt", "github-prs.txt"],
      });
      expect(baseline.documents).toHaveLength(1);
    });
  });

  test.each<[string, Partial<CorpusFlags>, RegExp]>([
    ["an unknown kind", { kind: ["prose"] }, /Unknown kind prose/],
    ["a register that is not on disk", { baseline: ["blog.txt"] }, /No register blog.txt/],
  ])("refuses %s", async (_name, flags, message) => {
    await withDataDir(async (dataDir) => {
      const failure = await selectCorpora({ ...NO_FLAGS, dataDir, ...flags }).catch(
        (error: Error) => error.message,
      );
      expect(failure).toMatch(message);
    });
  });
});

describe("corpusHeader", () => {
  test("counts what survived selection, not what was on disk", async () => {
    await withDataDir(async (dataDir) => {
      const selection = await selectCorpora({ ...NO_FLAGS, dataDir, kind: ["message"] });
      expect(corpusHeader(selection, { study: 78_424, baseline: 28_411 })).toEqual({
        study: { path: selection.study.path, kinds: ["message"], docs: 1, tokens: 78_424 },
        baseline: {
          names: ["github-prs.txt", "github-issues.txt"],
          docs: 2,
          tokens: 28_411,
        },
      });
    });
  });
});

describe("corpusHeaderLines", () => {
  test("names both corpora on one line each", () => {
    expect(
      corpusHeaderLines({
        study: { path: "/data/deliverables.txt", kinds: ["message"], docs: 559, tokens: 78_424 },
        baseline: { names: ["github-prs.txt", "github-issues.txt"], docs: 342, tokens: 28_411 },
      }),
    ).toMatchInlineSnapshot(`
      [
        "corpus A  559 docs, 78,424 tokens  kinds message  /data/deliverables.txt",
        "corpus B  342 docs, 28,411 tokens  github-prs.txt, github-issues.txt",
      ]
    `);
  });
});
