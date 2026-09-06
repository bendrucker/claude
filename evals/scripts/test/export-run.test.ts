import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { CommandOptions, CommandResult, RunCommand } from "../command";
import {
  assertSuiteMatch,
  exportRun,
  hasAwsCredentials,
  NO_CREDENTIALS_NOTICE,
  S3_DESTINATION,
  syncCommand,
  syncNotice,
  type SyncOutcome,
  syncResults,
  UNAUTHORIZED_NOTICE,
} from "../export-run";
import { CONFIG_DIR_VAR } from "../promptfoo";

const EXPORTS = join(import.meta.dirname, "exports");

interface Call {
  command: string[];
  options: CommandOptions | undefined;
}

/** Stands in for the promptfoo CLI: writes `fixture` wherever `-o` points. */
function exporter(fixture: string, calls: Call[]): RunCommand {
  return async (command, options) => {
    calls.push({ command: [...command], options });
    const target = command[command.indexOf("-o") + 1];
    if (target !== undefined) await Bun.write(target, Bun.file(join(EXPORTS, fixture)));
    return { code: 0, stdout: "", stderr: "" };
  };
}

async function withCorpus<T>(body: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "eval-results-"));
  try {
    return await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("exportRun files the export under the derived suite and run date", async () => {
  const calls: Call[] = [];
  await withCorpus(async (dir) => {
    const exported = await exportRun({
      evalId: "latest",
      dir,
      run: exporter("described.json", calls),
    });

    expect(relative(dir, exported.path)).toBe(
      "pr-body-a-b/2026-08-27-eval-xyz-2026-08-27T14-05-00.json",
    );
    expect(await Bun.file(exported.path).json()).toEqual(
      await Bun.file(join(EXPORTS, "described.json")).json(),
    );
    expect(exported.payload.evalId).toBe("eval-xyz-2026-08-27T14:05:00");
  });

  const [call] = calls;
  expect(call?.command.slice(0, 4)).toEqual(["bunx", "promptfoo", "export", "eval"]);
  expect(call?.command).toContain("latest");
  expect(call?.options?.env?.[CONFIG_DIR_VAR]).toContain(join(".cache", "promptfoo"));
});

test("exportRun honors suite and date overrides", async () => {
  await withCorpus(async (dir) => {
    const exported = await exportRun({
      evalId: "eval-nod-2026-08-26T11:00:00",
      dir,
      suite: "pr-body",
      date: "2026-08-26",
      run: exporter("undated.json", []),
    });

    expect(relative(dir, exported.path)).toBe(
      "pr-body/2026-08-26-eval-nod-2026-08-26T11-00-00.json",
    );
  });
});

test("exportRun refuses a timestampless export rather than dating it from the clock", () => {
  const attempt = exportRun({
    evalId: "latest",
    dir: "/corpus",
    suite: "pr-body",
    run: exporter("undated.json", []),
  });
  expect(attempt).rejects.toThrow(/no run timestamp/);
});

test.each<{ name: string; description?: string; suite: string; ok: boolean }>([
  {
    name: "a self-identifying run",
    description: "pr-body: guidance A/B",
    suite: "pr-body",
    ok: true,
  },
  { name: "a slugged prefix", description: "PR body A/B", suite: "pr-body", ok: true },
  {
    name: "another suite's run",
    description: "issue-refine rubric suite",
    suite: "pr-body",
    ok: false,
  },
  { name: "a run with no description", suite: "pr-body", ok: false },
])("assertSuiteMatch rejects filing $name under the wrong suite", ({ description, suite, ok }) => {
  const payload = { evalId: "eval-x", config: { description } };
  const attempt = () => assertSuiteMatch(payload, suite);
  if (ok) expect(attempt).not.toThrow();
  else expect(attempt).toThrow(/pass its eval id explicitly/);
});

test("exportRun refuses to file another suite's latest export", () => {
  const attempt = withCorpus((dir) =>
    exportRun({
      evalId: "latest",
      dir,
      suite: "issue-refine",
      run: exporter("described.json", []),
    }),
  );
  expect(attempt).rejects.toThrow(/not a issue-refine run/);
});

test("syncCommand mirrors the corpus into the eval-results prefix", () => {
  expect(syncCommand("/corpus", S3_DESTINATION)).toEqual([
    "aws",
    "s3",
    "sync",
    "/corpus",
    "s3://ben-drucker-agents-eval-corpus/eval-results/",
    "--exclude",
    ".DS_Store",
  ]);
});

/** Answers per AWS subcommand (`sts`, `s3`), defaulting to success. */
function responder(results: Record<string, CommandResult>, calls: Call[]): RunCommand {
  return (command, options) => {
    calls.push({ command: [...command], options });
    const key = command[1] ?? "";
    return Promise.resolve(results[key] ?? { code: 0, stdout: "", stderr: "" });
  };
}

test.each<{ name: string; probe: CommandResult; expected: boolean }>([
  { name: "an authenticated caller", probe: { code: 0, stdout: "{}", stderr: "" }, expected: true },
  {
    name: "an expired profile",
    probe: { code: 255, stdout: "", stderr: "Unable to locate credentials" },
    expected: false,
  },
  {
    name: "an uninstalled AWS CLI",
    probe: { code: 127, stdout: "", stderr: "spawn aws ENOENT" },
    expected: false,
  },
])("hasAwsCredentials reports $name", async ({ probe, expected }) => {
  expect(await hasAwsCredentials(responder({ sts: probe }, []))).toBe(expected);
});

test.each<{ name: string; results: Record<string, CommandResult>; outcome: SyncOutcome }>([
  { name: "uploads when credentials resolve", results: {}, outcome: "synced" },
  {
    name: "skips when credentials are absent",
    results: { sts: { code: 255, stdout: "", stderr: "Unable to locate credentials" } },
    outcome: "no-credentials",
  },
  {
    name: "skips when the caller cannot reach the bucket",
    results: {
      s3: {
        code: 1,
        stdout: "",
        stderr: "An error occurred (AccessDenied) when calling the ListObjectsV2 operation",
      },
    },
    outcome: "unauthorized",
  },
  {
    name: "skips when the session token has expired",
    results: { s3: { code: 1, stdout: "", stderr: "An error occurred (ExpiredToken)" } },
    outcome: "unauthorized",
  },
])("syncResults $name", async ({ results, outcome }) => {
  expect(await syncResults("/corpus", S3_DESTINATION, responder(results, []))).toBe(outcome);
});

test("syncResults rethrows a sync failure that is not an authorization refusal", () => {
  const responses = { s3: { code: 1, stdout: "", stderr: "Connection was closed" } };
  expect(syncResults("/corpus", S3_DESTINATION, responder(responses, []))).rejects.toThrow(
    "Connection was closed",
  );
});

test.each<{ outcome: SyncOutcome; expected: string }>([
  { outcome: "synced", expected: `Synced /corpus to ${S3_DESTINATION}` },
  { outcome: "no-credentials", expected: NO_CREDENTIALS_NOTICE },
  { outcome: "unauthorized", expected: UNAUTHORIZED_NOTICE },
])("syncNotice reports $outcome", ({ outcome, expected }) => {
  expect(syncNotice(outcome, "/corpus", S3_DESTINATION)).toBe(expected);
});
