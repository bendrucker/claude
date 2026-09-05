#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: build and mine-contrast write the plugin data dir under ~/.claude/plugins
import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cli, command } from "cleye";
import { buildStyleProfile, type CorpusDocument } from "../similarity/build";
import { loadStyleProfile, saveStyleProfile, type StyleProfile } from "../similarity/profile";
import { DEFAULT_EXCERPT_WIDTH, renderReport } from "../similarity/report";
import { scoreDocument } from "../similarity/score";
import { segment } from "../similarity/segment";
import { flagWindows, localize } from "../similarity/windows";
import {
  contrastBaselineDir,
  contrastCorpusPath,
  registerPaths,
  resolveDataDir,
  similarityProfilePath,
  voiceBaselineDir,
} from "../skills/analyze/scripts/data-dir";
import { openSessionDb } from "../skills/analyze/scripts/db";
import { DeliverableRow } from "../skills/analyze/scripts/dump";
import { parseCorpus, serializeCorpus } from "../skills/analyze/scripts/voice-corpus";
import { readInput } from "./io";

const dataDirFlag = {
  type: String,
  description:
    "Local data dir (default: CLAUDE_PLUGIN_DATA or ~/.claude/plugins/data/writing-bendrucker)",
} as const;

async function readCorpus(path: string): Promise<CorpusDocument[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) return [];
  return parseCorpus(await file.text());
}

async function loadRegisters(dataDir: string): Promise<CorpusDocument[]> {
  const paths = await registerPaths(dataDir);
  const perRegister = await Promise.all(paths.map(readCorpus));
  return perRegister.flat();
}

async function requireProfile(path: string): Promise<StyleProfile> {
  const profile = await loadStyleProfile(path);
  if (profile === null) {
    throw new Error(`No similarity profile at ${path}. Run \`similarity.ts build\` first.`);
  }
  return profile;
}

const buildCommand = command(
  {
    name: "build",
    help: {
      description:
        "Compute the two-pole style profile from the voice registers and the contrast corpus.",
    },
    flags: {
      dataDir: dataDirFlag,
      vocabularySize: { type: Number, description: "Char 3-grams kept in the profile vocabulary" },
      windowSentences: { type: Number, description: "Sentences per sliding window" },
      minWords: { type: Number, description: "Shortest document admitted to either pole" },
      out: { type: String, description: "Profile output path" },
    },
  },
  async (parsed) => {
    const dataDir = resolveDataDir(parsed.flags.dataDir);
    const contrastPath = contrastCorpusPath(dataDir);
    const [voice, contrast] = await Promise.all([loadRegisters(dataDir), readCorpus(contrastPath)]);
    if (voice.length === 0) {
      throw new Error(`No voice registers under ${voiceBaselineDir(dataDir)}`);
    }
    if (contrast.length === 0) {
      throw new Error(
        `No contrast corpus at ${contrastPath}. Run \`similarity.ts mine-contrast --session-db <path>\` first.`,
      );
    }

    const started = performance.now();
    const { profile, skipped } = buildStyleProfile(voice, contrast, {
      generatedAt: new Date().toISOString(),
      vocabularySize: parsed.flags.vocabularySize,
      windowSentences: parsed.flags.windowSentences,
      minWords: parsed.flags.minWords,
    });

    const out = parsed.flags.out ?? similarityProfilePath(dataDir);
    mkdirSync(dirname(out), { recursive: true });
    await saveStyleProfile(out, profile);

    const elapsed = ((performance.now() - started) / 1000).toFixed(1);
    console.error(
      `voice: ${profile.voice.documentCount} documents / ${profile.voice.wordCount.toLocaleString()} words (${skipped.voice} below floor)`,
    );
    console.error(
      `contrast: ${profile.contrast.documentCount} documents / ${profile.contrast.wordCount.toLocaleString()} words (${skipped.contrast} below floor)`,
    );
    console.error(
      `calibration: ${profile.documentCalibration.fused.sampleSize} documents, ${profile.windowCalibration.fused.sampleSize} windows, ${elapsed}s`,
    );
    process.stdout.write(`${out}\n`);
  },
);

const scoreCommand = command(
  {
    name: "score",
    parameters: ["[input]"],
    help: {
      description: "Score a file, an inline string, or stdin against the voice baseline.",
    },
    flags: {
      dataDir: dataDirFlag,
      profile: { type: String, description: "Profile path (default: the data dir's)" },
      belowPercentile: {
        type: Number,
        default: 10,
        description: "Flag windows below this percentile of the voice baseline",
      },
      truncate: {
        type: Number,
        default: DEFAULT_EXCERPT_WIDTH,
        description: "Excerpt width in characters",
      },
      json: { type: Boolean, description: "Emit the report as JSON" },
    },
  },
  async (parsed) => {
    const dataDir = resolveDataDir(parsed.flags.dataDir);
    const profilePath = parsed.flags.profile ?? similarityProfilePath(dataDir);
    const profile = await requireProfile(profilePath);

    const { text, filePath } = await readInput(parsed._.input);
    if (text.trim() === "") throw new Error("No input text");

    const doc = segment(text);
    const score = scoreDocument(doc, profile, profile.documentCalibration);
    const windows = localize(doc, profile);
    const report = {
      input: filePath,
      score,
      flagged: flagWindows(windows, parsed.flags.belowPercentile),
      windowCount: windows.length,
      threshold: parsed.flags.belowPercentile,
    };

    if (parsed.flags.json === true) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }
    process.stdout.write(`${renderReport(report, profile, parsed.flags.truncate)}\n`);
  },
);

const mineContrastCommand = command(
  {
    name: "mine-contrast",
    help: {
      description:
        "Build the contrast pole from Claude-authored prose in the session index. Local-only, never committed.",
    },
    flags: {
      dataDir: dataDirFlag,
      sessionDb: { type: String, description: "Path to the session DuckDB index" },
      since: { type: String, description: "Earliest session date (YYYY-MM-DD)" },
      until: { type: String, description: "Latest session date (YYYY-MM-DD)" },
      project: { type: String, description: "Restrict to matching project paths" },
      minWords: { type: Number, default: 60, description: "Shortest document kept" },
    },
  },
  async (parsed) => {
    const sessionDb = parsed.flags.sessionDb;
    if (sessionDb === undefined || sessionDb === "") {
      throw new Error("--session-db is required (the claude-code:session skill prints its path)");
    }
    const dataDir = resolveDataDir(parsed.flags.dataDir);

    // The session index is written by other sessions. Copy it so a long scan
    // cannot contend with a concurrent refresh. The name carries the session id
    // so two mine-contrast runs cannot overwrite each other's copy.
    const sessionId = process.env.CLAUDE_SESSION_ID ?? "anonymous";
    const scratch = join(tmpdir(), `similarity-contrast-${sessionId}.duckdb`);
    await Bun.write(scratch, Bun.file(sessionDb));

    const db = await openSessionDb(scratch);
    let rows;
    try {
      rows = await db.runQuery("deliverable-prose", DeliverableRow, {
        after_date: parsed.flags.since ?? null,
        before_date: parsed.flags.until ?? null,
        project: parsed.flags.project ?? null,
        model: null,
      });
    } finally {
      db.close();
      await rm(scratch, { force: true });
    }

    const documents = rows
      .filter((row) => segment(row.text).words.length >= parsed.flags.minWords)
      .map((row, index) => ({
        // One file is written and edited many times across a session, so the
        // path alone is not a unique pointer. Whitespace would break the
        // corpus delimiter line, which drops the document on the way back in.
        source: `${(row.file_path ?? row.session_id).replaceAll(/\s+/g, "_")}#${index}`,
        meta: row.session_id,
        body: row.text,
      }));
    if (documents.length === 0) throw new Error("No deliverable prose matched");

    const out = contrastCorpusPath(dataDir);
    mkdirSync(contrastBaselineDir(dataDir), { recursive: true });
    await Bun.write(out, serializeCorpus(documents));
    console.error(`contrast corpus: ${documents.length} documents from ${rows.length} rows`);
    process.stdout.write(`${out}\n`);
  },
);

if (import.meta.main) {
  try {
    await cli(
      {
        name: "similarity",
        commands: [buildCommand, scoreCommand, mineContrastCommand],
        help: {
          description: "Score prose against the local voice baseline by style similarity.",
        },
      },
      (parsed) => {
        parsed.showHelp();
      },
    );
  } catch (error) {
    // A stale profile and a bad flag both reach here. Their messages say what
    // to do, which a stack trace buries.
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
