#!/usr/bin/env bun

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PLUGIN_DIR = join(import.meta.dirname, "..");
const FIXTURE_DIR = join(import.meta.dirname, "e2e-fixtures");
const RUN_TIMEOUT_MS = 3 * 60 * 1000;
const DENY_REASON_FRAGMENT = "test counts";

interface Case {
  name: string;
  /** External CLI the case drives, stubbed onto PATH. */
  cli: "gh" | "glab";
  /** How the body reaches the CLI, as the create/update skills write it. */
  command: (fixturePath: string) => string;
  /** Substring of a stub log line that means the CLI was reached. */
  marker: string;
  fixture: string;
  expectCreate: boolean;
}

// GitLab is covered through both forms it accepts: the `--description-file`
// path the skills now document, and the `--description "$(cat ...)"` command
// substitution they used to.
const CASES: Case[] = [
  {
    name: "gh deny",
    cli: "gh",
    command: (fixture) => `gh pr create --title "e2e" --body-file ${fixture}`,
    marker: "pr create",
    fixture: "deny.md",
    expectCreate: false,
  },
  {
    name: "gh clean",
    cli: "gh",
    command: (fixture) => `gh pr create --title "e2e" --body-file ${fixture}`,
    marker: "pr create",
    fixture: "clean.md",
    expectCreate: true,
  },
  {
    name: "glab deny",
    cli: "glab",
    command: (fixture) => `glab mr create --title "e2e" --description "$(cat ${fixture})"`,
    marker: "mr create",
    fixture: "deny.md",
    expectCreate: false,
  },
  {
    name: "glab clean",
    cli: "glab",
    command: (fixture) => `glab mr create --title "e2e" --description-file ${fixture}`,
    marker: "mr create",
    fixture: "clean.md",
    expectCreate: true,
  },
];

interface RunResult {
  output: string;
  timedOut: boolean;
  exitCode: number;
}

async function run(
  command: string[],
  cwd: string,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const proc = Bun.spawn(command, { cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`${command.join(" ")} failed (${code}):\n${stdout}${stderr}`);
  }
}

async function setupRepo(root: string): Promise<void> {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
  const git = (args: string[]) => run(["git", ...args], root, env);
  await git(["init", "-b", "main"]);
  await git(["config", "user.email", "e2e@example.com"]);
  await git(["config", "user.name", "E2E"]);
  await Bun.write(join(root, "README.md"), "# e2e\n");
  await git(["add", "README.md"]);
  await git(["commit", "-m", "init"]);
}

async function setupCliStubs(root: string): Promise<{ binDir: string; logPath: string }> {
  const binDir = join(root, "bin");
  const logPath = join(root, "cli-invocations.log");
  await mkdir(binDir, { recursive: true });
  for (const cli of ["gh", "glab"]) {
    const stub = join(binDir, cli);
    await Bun.write(
      stub,
      `#!/bin/sh\nprintf '%s %s\\n' ${cli} "$*" >> ${JSON.stringify(logPath)}\nexit 0\n`,
    );
    await run(["chmod", "+x", stub], root);
  }
  await Bun.write(logPath, "");
  return { binDir, logPath };
}

function instruction(command: string): string {
  return [
    "Run exactly one command with the Bash tool:",
    command,
    "Run nothing else. Do not read, write, or edit any file.",
    "If the command is blocked, do not retry it and do not change anything.",
    "Then stop and reply with the single word done.",
  ].join(" ");
}

async function runClaude(cwd: string, binDir: string, prompt: string): Promise<RunResult> {
  const proc = Bun.spawn(
    [
      "claude",
      "-p",
      prompt,
      "--plugin-dir",
      PLUGIN_DIR,
      "--setting-sources",
      "local",
      "--model",
      "haiku",
      "--allowedTools",
      "Bash",
      "--output-format",
      "stream-json",
      "--verbose",
    ],
    {
      cwd,
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, RUN_TIMEOUT_MS);

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  clearTimeout(timer);

  return { output: `${stdout}${stderr}`, timedOut, exitCode };
}

async function createCount(logPath: string, marker: string): Promise<number> {
  const log = await Bun.file(logPath).text();
  return log.split("\n").filter((line) => line.includes(marker)).length;
}

async function runCase(testCase: Case, root: string, binDir: string, logPath: string) {
  const fixturePath = join(FIXTURE_DIR, testCase.fixture);
  await Bun.write(logPath, "");

  const command = testCase.command(fixturePath);
  const { output, timedOut, exitCode } = await runClaude(root, binDir, instruction(command));
  const failures: string[] = [];

  if (timedOut) {
    failures.push(`claude timed out after ${RUN_TIMEOUT_MS / 1000}s`);
  } else if (exitCode !== 0) {
    failures.push(`claude exited ${exitCode}`);
  }

  const created = await createCount(logPath, testCase.marker);
  if (testCase.expectCreate && created === 0) {
    failures.push(
      `expected the ${testCase.cli} stub to record a \`${testCase.marker}\`, it recorded none`,
    );
  }
  if (!testCase.expectCreate) {
    if (created > 0) {
      failures.push(
        `hook did not block: ${testCase.cli} stub recorded ${created} \`${testCase.marker}\` invocation(s)`,
      );
    }
    if (!output.includes(DENY_REASON_FRAGMENT)) {
      failures.push(`stream output never mentioned "${DENY_REASON_FRAGMENT}"`);
    }
  }

  return { failures, output };
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "pr-hook-e2e-"));
  let failed = false;
  try {
    await setupRepo(root);
    const { binDir, logPath } = await setupCliStubs(root);

    for (const testCase of CASES) {
      const { failures, output } = await runCase(testCase, root, binDir, logPath);
      if (failures.length === 0) {
        console.log(`PASS ${testCase.name}`);
        continue;
      }
      failed = true;
      console.log(`FAIL ${testCase.name}`);
      for (const failure of failures) {
        console.log(`  - ${failure}`);
      }
      console.log(output.split("\n").slice(-40).join("\n"));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  if (failed) {
    process.exit(1);
  }
}

await main();
