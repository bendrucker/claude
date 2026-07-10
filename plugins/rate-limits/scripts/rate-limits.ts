#!/usr/bin/env bun

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cli, command } from "cleye";
import { type Check, type CheckStatus, runDoctor } from "./doctor";
import { historyPath, rateLimitsPath } from "./history";
import { resolveOptions } from "./predict";
import { runStatus } from "./status";

const PLUGIN_ROOT = join(import.meta.dirname, "..");

const color = (code: number, text: string) => `\x1b[${code}m${text}\x1b[0m`;

const MARK: Record<CheckStatus, string> = {
  pass: color(32, "✓"),
  fail: color(31, "✗"),
  warn: color(33, "!"),
  info: color(34, "·"),
};

function printCheck(check: Check): void {
  console.log(`${MARK[check.status]} ${check.name}: ${check.detail}`);
  if (check.remediation) {
    console.log(`    ${color(90, check.remediation)}`);
  }
}

const doctorCmd = command(
  {
    name: "doctor",
    help: {
      description:
        "Verify the usage-limit pipeline: rl.json, history, compiled hook, and statusline recorder.",
    },
    flags: {
      maxAge: {
        type: Number,
        default: 300,
        description: "Seconds before rl.json or history is stale (recorder not reporting)",
      },
    },
  },
  async (parsed) => {
    const report = await runDoctor({
      rlPath: rateLimitsPath(),
      rlFromEnv: Boolean(process.env.CLAUDE_STATUSLINE_RATE_LIMITS_PATH),
      historyPath: historyPath(),
      binPath: join(PLUGIN_ROOT, "bin", "alert"),
      settingsPath: join(homedir(), ".claude", "settings.json"),
      minSamples: resolveOptions().minSamples,
      nowMs: Date.now(),
      maxAgeMs: parsed.flags.maxAge * 1000,
    });

    for (const check of report.checks) printCheck(check);
    console.log();
    console.log(
      report.ok
        ? color(32, "Reporting pipeline healthy.")
        : color(31, "Reporting pipeline broken. See remediation above."),
    );
    process.exit(report.ok ? 0 : 1);
  },
);

const statusCmd = command(
  {
    name: "status",
    help: {
      description:
        "Report current usage per window and the projected 5-hour exhaustion, then stamp the marker.",
    },
  },
  async () => {
    const result = await runStatus(Date.now(), process.env.CLAUDE_SESSION_ID);
    if (!result) {
      console.error(
        color(
          31,
          "No usage-limit data available. Run `rate-limits doctor` to diagnose the pipeline.",
        ),
      );
      process.exit(1);
    }
    console.log(result.lines.join("\n"));
  },
);

async function compileAlert(): Promise<boolean> {
  const src = join(PLUGIN_ROOT, "hooks", "alert.ts");
  const out = join(PLUGIN_ROOT, "bin", "alert");
  mkdirSync(join(PLUGIN_ROOT, "bin"), { recursive: true });
  const proc = Bun.spawn(["bun", "build", src, "--compile", "--outfile", out], {
    stdout: "inherit",
    stderr: "inherit",
  });
  return (await proc.exited) === 0;
}

async function recorderWired(): Promise<boolean> {
  try {
    const settings = JSON.parse(await Bun.file(join(homedir(), ".claude", "settings.json")).text());
    const command = settings?.statusLine?.command;
    return typeof command === "string" && command.includes("recorder");
  } catch {
    return false;
  }
}

const installCmd = command(
  {
    name: "install",
    help: {
      description: "Compile the alert hook to bin/alert and verify the statusline recorder wiring.",
    },
  },
  async () => {
    const compiled = await compileAlert();
    if (!compiled) {
      console.error(color(31, "Failed to compile bin/alert."));
      process.exit(1);
    }
    console.log(`${color(32, "✓")} compiled ${join(PLUGIN_ROOT, "bin", "alert")}`);

    if (await recorderWired()) {
      console.log(`${color(32, "✓")} statusline recorder is wired`);
    } else {
      const recorder = join(PLUGIN_ROOT, "scripts", "recorder.ts");
      console.log(`${color(33, "!")} statusline recorder is not wired`);
      console.log(
        color(
          90,
          `  Set statusLine.command in ~/.claude/settings.json to wrap your statusline:\n` +
            `  bun ${recorder} -- <your existing statusline command>`,
        ),
      );
    }
  },
);

cli(
  {
    name: "rate-limits",
    commands: [doctorCmd, statusCmd, installCmd],
  },
  (parsed) => {
    parsed.showHelp();
  },
);
