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
  fixture: string;
  expectCreate: boolean;
}

const CASES: Case[] = [
  { name: "deny", fixture: "deny.md", expectCreate: false },
  { name: "clean", fixture: "clean.md", expectCreate: true },
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

async function setupGhStub(root: string): Promise<{ binDir: string; logPath: string }> {
  const binDir = join(root, "bin");
  const logPath = join(root, "gh-invocations.log");
  await mkdir(binDir, { recursive: true });
  const stub = join(binDir, "gh");
  await Bun.write(stub, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(logPath)}\nexit 0\n`);
  await run(["chmod", "+x", stub], root);
  await Bun.write(logPath, "");
  return { binDir, logPath };
}

function instruction(fixturePath: string): string {
  return [
    "Run exactly one command with the Bash tool:",
    `gh pr create --title "e2e" --body-file ${fixturePath}`,
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

async function prCreateCount(logPath: string): Promise<number> {
  const log = await Bun.file(logPath).text();
  return log.split("\n").filter((line) => line.includes("pr create")).length;
}

async function runCase(testCase: Case, root: string, binDir: string, logPath: string) {
  const fixturePath = join(FIXTURE_DIR, testCase.fixture);
  await Bun.write(logPath, "");

  const { output, timedOut, exitCode } = await runClaude(root, binDir, instruction(fixturePath));
  const failures: string[] = [];

  if (timedOut) {
    failures.push(`claude timed out after ${RUN_TIMEOUT_MS / 1000}s`);
  } else if (exitCode !== 0) {
    failures.push(`claude exited ${exitCode}`);
  }

  const created = await prCreateCount(logPath);
  if (testCase.expectCreate && created === 0) {
    failures.push("expected the gh stub to record a `pr create`, it recorded none");
  }
  if (!testCase.expectCreate) {
    if (created > 0) {
      failures.push(`hook did not block: gh stub recorded ${created} \`pr create\` invocation(s)`);
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
    const { binDir, logPath } = await setupGhStub(root);

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
