import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { type AnalysisConfig, runAnalysis } from "./analyze";
import { type Database, openSessionDb } from "./db";

// The queries reference macros and tables supplied by the external session
// index (built by the claude-code:session skill), not defined in this repo. The
// fixture recreates the minimal seam each query touches: the date/project
// filter macros and the sessions/text_content/content_items tables. The macros
// cast their variable arguments because getvariable() yields untyped NULLs.
async function seedSchema(db: Database): Promise<void> {
  await db.run(`
    CREATE MACRO date_filter(ts, after, before) AS (
      (after IS NULL OR ts::DATE >= after::VARCHAR::DATE)
      AND (before IS NULL OR ts::DATE <= before::VARCHAR::DATE)
    );
    CREATE MACRO project_filter(project_path, pattern) AS (
      pattern IS NULL OR project_path GLOB pattern::VARCHAR
    );
  `);
  await db.run(`
    CREATE TABLE sessions (
      host VARCHAR, session_id VARCHAR, project_path VARCHAR
    );
    CREATE TABLE text_content (
      host VARCHAR, session_id VARCHAR, source_file VARCHAR, source_line BIGINT,
      timestamp TIMESTAMP, role VARCHAR, model VARCHAR, text VARCHAR,
      is_system BOOLEAN, is_subagent BOOLEAN
    );
    CREATE TABLE content_items (
      host VARCHAR, session_id VARCHAR, source_file VARCHAR, source_line BIGINT,
      timestamp TIMESTAMP, type VARCHAR, name VARCHAR, data JSON
    );
  `);
}

async function seedRows(db: Database, projectPath: string): Promise<void> {
  await db.run(`
    INSERT INTO sessions VALUES ('h1', 's1', '${projectPath}');
    INSERT INTO text_content VALUES
      ('h1','s1','f.jsonl',1,'2026-05-20T10:00:00Z','assistant','claude-opus-4',
       'This is a delightful tapestry of ideas that we can weave together for you here today and beyond.',
       false, false),
      ('h1','s1','f.jsonl',2,'2026-05-20T10:01:00Z','user',NULL,
       'no thats wrong fix the flowery writing please it reads like marketing fluff to me okay friend',
       false, false);
    INSERT INTO content_items VALUES
      ('h1','s1','f.jsonl',3,'2026-05-20T10:02:00Z','tool_use','Write',
       '{"input":{"file_path":"${projectPath}/README.md","content":"This document is a comprehensive source of truth that delves into the rich tapestry of our delightful project offering."}}');
  `);
}

async function fixtureWordlists(): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), "analyze-wordlists-"));
  await Bun.write(path.join(dir, "vocabulary.txt"), "tapestry\ndelve\n");
  await Bun.write(path.join(dir, "flowery-phrases.txt"), "source of truth\n");
  return dir;
}

function baseConfig(wordlistsDir: string): AnalysisConfig {
  return {
    generatedAt: "2026-05-24",
    since: "2026-05-01",
    until: "2026-05-31",
    modelFilter: "*opus*",
    projectFilter: null,
    minLift: 5,
    minCount: 5,
    topN: 10,
    tagMinLift: 2,
    tagTop: 10,
    wordlistsDir,
    // No profile on disk: loadProfile returns null and the deliverable-surface
    // rule is kept pending a baseline rather than measured for distinctiveness.
    dataDir: path.join(tmpdir(), "analyze-no-such-data-dir"),
    pasteMaxChars: 2000,
    selfName: "",
    correctiveLimit: 25,
  };
}

describe("runAnalysis", () => {
  let db: Database;
  let wordlistsDir: string;

  beforeAll(async () => {
    wordlistsDir = await fixtureWordlists();
    db = await openSessionDb(":memory:");
    await seedSchema(db);
    await seedRows(db, "/home/u/proj");
  });

  afterAll(() => {
    db.close();
  });

  test("assembles a well-formed ReportInput over the fixture DB", async () => {
    const result = await runAnalysis(db, baseConfig(wordlistsDir));

    // Config-derived fields, model summary, and rule-health coverage pass
    // through deterministically.
    expect({
      generatedAt: result.generatedAt,
      since: result.since,
      until: result.until,
      modelFilter: result.modelFilter,
      projectFilter: result.projectFilter,
      minLift: result.minLift,
      minCount: result.minCount,
      topN: result.topN,
      modelSummaryLength: result.modelSummary.length,
      model: result.modelSummary[0]?.model,
      voiceProfile: result.voiceProfile,
      ruleHealthLength: result.ruleHealth.length,
      surfaces: [...new Set(result.ruleHealth.map((r) => r.surface))].sort(),
    }).toMatchInlineSnapshot(`
      {
        "generatedAt": "2026-05-24",
        "minCount": 5,
        "minLift": 5,
        "model": "claude-opus-4",
        "modelFilter": "*opus*",
        "modelSummaryLength": 1,
        "projectFilter": null,
        "ruleHealthLength": 3,
        "since": "2026-05-01",
        "surfaces": [
          "chat",
          "deliverable",
        ],
        "topN": 10,
        "until": "2026-05-31",
        "voiceProfile": null,
      }
    `);

    // Corpus character totals come from the seeded rows, routed by role and
    // deliverable extraction.
    expect(result.assistantTotalChars).toBeGreaterThan(0);
    expect(result.deliverableTotalChars).toBeGreaterThan(0);
    expect(result.userTotalChars).toBeGreaterThan(0);

    // The corrective-feedback query matched the frustration lexicon on the
    // seeded user reply.
    expect(result.corrective.length).toBeGreaterThan(0);
    expect(result.corrective[0]?.matched_term.length).toBeGreaterThan(0);

    expect(typeof result.rateTrends).toBe("object");
    expect(result.rateTrends.documentCount).toBeGreaterThanOrEqual(0);

    expect(Array.isArray(result.candidatePhrases)).toBe(true);
    expect(Array.isArray(result.structuralSignatures)).toBe(true);
    expect(Array.isArray(result.structuralAudit)).toBe(true);
    expect(Array.isArray(result.corrections)).toBe(true);
  });

  test("scopes the corpus to the date window", async () => {
    const outOfWindow = baseConfig(wordlistsDir);
    outOfWindow.since = "2026-01-01";
    outOfWindow.until = "2026-01-31";
    const result = await runAnalysis(db, outOfWindow);

    expect(result.assistantTotalChars).toBe(0);
    expect(result.deliverableTotalChars).toBe(0);
    expect(result.modelSummary).toHaveLength(0);
    expect(result.corrective).toHaveLength(0);
  });
});
