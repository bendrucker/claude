#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import { cli } from "cleye";
import { z } from "zod";
import { corpusPath, resolveDataDir, voiceBaselineDir } from "./data-dir";
import { mergeDocuments, parseCorpus, serializeCorpus, type VoiceDocument } from "./voice-corpus";

const argv = cli({
  name: "ingest-voice",
  flags: {
    dataDir: {
      type: String,
      description:
        "Local data dir for the voice baseline (default: CLAUDE_PLUGIN_DATA or ~/.claude/plugins/data/writing-bendrucker)",
    },
    source: {
      type: String,
      description: "Source to ingest: 'github' (via gh search prs) or 'file' (a delimited corpus)",
      default: "github",
    },
    author: {
      type: String,
      description: "GitHub author to fetch merged PRs for (github source)",
    },
    created: {
      type: String,
      description: "gh search date range, e.g. 2019-01-01..2024-01-01 (github source)",
    },
    limit: {
      type: Number,
      description: "Max PRs to fetch (github source)",
      default: 200,
    },
    file: {
      type: String,
      description: "Path to a delimited corpus file to merge in (file source)",
    },
  },
});

const dataDir = resolveDataDir(argv.flags.dataDir);
const target = corpusPath(dataDir);

await main();

async function main(): Promise<void> {
  mkdirSync(voiceBaselineDir(dataDir), { recursive: true });

  const existing = await readExisting(target);
  const incoming = await collectIncoming();
  if (incoming.length === 0) {
    console.error("No documents to ingest.");
    return;
  }

  const merged = mergeDocuments(existing, incoming);
  const added = merged.length - existing.length;
  await Bun.write(target, serializeCorpus(merged));
  console.error(
    `Ingested ${incoming.length} document(s) from '${argv.flags.source}'; ${added} new, ${merged.length} total.`,
  );
  process.stdout.write(`${target}\n`);
}

async function collectIncoming(): Promise<VoiceDocument[]> {
  if (argv.flags.source === "github") return fetchGithub();
  if (argv.flags.source === "file") return readFileSource();
  throw new Error(`Unknown source: ${argv.flags.source}. Use 'github' or 'file'.`);
}

const SearchResults = z.array(
  z.object({ url: z.string(), body: z.string(), createdAt: z.string() }),
);

async function fetchGithub(): Promise<VoiceDocument[]> {
  const author = argv.flags.author;
  if (author == null || author === "") {
    throw new Error("--author is required for the github source");
  }
  // gh search prs does not expose diff sizes, so the meta line carries the
  // creation date only. The seed corpus retains its richer +x/-y metadata; new
  // fetches simply omit it. Metadata is provenance, not counted as prose.
  const args = [
    "search",
    "prs",
    `--author=${author}`,
    "--merged",
    `--limit=${argv.flags.limit}`,
    "--json",
    "url,body,createdAt",
  ];
  if (argv.flags.created != null && argv.flags.created !== "")
    args.push(`--created=${argv.flags.created}`);

  console.error(`Running: gh ${args.join(" ")}`);
  const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`gh search prs failed (exit ${exitCode}): ${stderr.trim()}`);
  }

  const results = SearchResults.parse(JSON.parse(stdout));

  return results
    .filter((pr) => pr.body.trim().length >= 30)
    .map((pr) => ({
      source: pr.url,
      meta: pr.createdAt,
      body: pr.body.trim(),
    }));
}

async function readFileSource(): Promise<VoiceDocument[]> {
  const file = argv.flags.file;
  if (file == null || file === "") {
    throw new Error("--file is required for the file source");
  }
  const text = await Bun.file(file).text();
  return parseCorpus(text);
}

async function readExisting(path: string): Promise<VoiceDocument[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) return [];
  return parseCorpus(await file.text());
}
