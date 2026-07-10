import { type HistorySample, type RateLimits, readHistory } from "./history";

export type CheckStatus = "pass" | "fail" | "warn" | "info";

export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
  remediation?: string;
}

export interface DoctorOptions {
  rlPath: string;
  rlFromEnv: boolean;
  historyPath: string;
  binPath: string;
  settingsPath: string;
  minSamples: number;
  nowMs: number;
  maxAgeMs: number;
}

export interface DoctorReport {
  checks: Check[];
  ok: boolean;
}

const RECORDER_REMEDIATION =
  "Wire the statusline recorder so rl.json and history are written on each render, then run `rate-limits install`. See the recorder example in the plugin README.";

const COMPILE_REMEDIATION = "Run `rate-limits install` to compile bin/alert.";

function ageLabel(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${minutes % 60}m`;
}

// Best-effort: the statusline check is informational, so an unreadable or
// command-less settings file downgrades to a warning rather than failing the
// report. The file checks below are what authoritatively decide `ok`.
async function checkStatusline(settingsPath: string): Promise<Check> {
  const name = "statusline configured";
  let settings: { statusLine?: { command?: string } } | null;
  try {
    settings = JSON.parse(await Bun.file(settingsPath).text());
  } catch {
    return {
      name,
      status: "warn",
      detail: `could not read ${settingsPath}`,
      remediation: RECORDER_REMEDIATION,
    };
  }

  const command = settings?.statusLine?.command;
  if (typeof command !== "string" || command.length === 0) {
    return {
      name,
      status: "warn",
      detail: "no statusLine.command in settings.json; nothing records usage",
      remediation: RECORDER_REMEDIATION,
    };
  }

  const wired = command.includes("recorder");
  return {
    name,
    status: wired ? "pass" : "warn",
    detail: wired ? command : `${command} (does not run the recorder)`,
    remediation: wired ? undefined : RECORDER_REMEDIATION,
  };
}

async function statMs(path: string): Promise<number | null> {
  try {
    return (await Bun.file(path).stat()).mtimeMs;
  } catch {
    return null;
  }
}

function checkFreshness(name: string, mtimeMs: number, opts: DoctorOptions): Check {
  const age = opts.nowMs - mtimeMs;
  if (age > opts.maxAgeMs) {
    return {
      name,
      status: "fail",
      detail: `last written ${ageLabel(age)} ago; the recorder is not reporting`,
      remediation: RECORDER_REMEDIATION,
    };
  }
  return { name, status: "pass", detail: `written ${ageLabel(age)} ago` };
}

function inBlockCount(history: HistorySample[], rl: RateLimits): number {
  const reset = rl.five_hour?.resets_at;
  if (typeof reset !== "number") return 0;
  return history.filter((s) => s.fiveReset === reset).length;
}

async function checkHistory(rl: RateLimits, opts: DoctorOptions): Promise<Check[]> {
  const checks: Check[] = [];
  const mtime = await statMs(opts.historyPath);
  if (mtime === null) {
    checks.push({
      name: "history exists",
      status: "fail",
      detail: `${opts.historyPath} not found`,
      remediation: RECORDER_REMEDIATION,
    });
    return checks;
  }
  checks.push({ name: "history exists", status: "pass", detail: opts.historyPath });
  checks.push(checkFreshness("history freshness", mtime, opts));

  const history = await readHistory(opts.historyPath);
  const count = inBlockCount(history, rl);
  if (count < opts.minSamples) {
    checks.push({
      name: "history samples",
      status: "fail",
      detail: `${count} sample(s) in the current block; need ${opts.minSamples} to project`,
      remediation: RECORDER_REMEDIATION,
    });
  } else {
    checks.push({
      name: "history samples",
      status: "pass",
      detail: `${count} sample(s) in the current block`,
    });
  }
  return checks;
}

async function checkBinary(binPath: string): Promise<Check> {
  const name = "compiled bin/alert";
  if (await Bun.file(binPath).exists()) {
    return { name, status: "pass", detail: binPath };
  }
  return {
    name,
    status: "warn",
    detail: "not compiled; the hook falls back to bun (slower cold start)",
    remediation: COMPILE_REMEDIATION,
  };
}

export async function runDoctor(opts: DoctorOptions): Promise<DoctorReport> {
  const checks: Check[] = [];

  checks.push({
    name: "rate_limits path",
    status: "info",
    detail: `${opts.rlPath} (${opts.rlFromEnv ? "CLAUDE_STATUSLINE_RATE_LIMITS_PATH" : "default"})`,
  });

  const statusline = await checkStatusline(opts.settingsPath);
  const binary = await checkBinary(opts.binPath);

  const rlMtime = await statMs(opts.rlPath);
  if (rlMtime === null) {
    checks.push({
      name: "rl.json exists",
      status: "fail",
      detail: "file not found",
      remediation: RECORDER_REMEDIATION,
    });
    checks.push(statusline, binary);
    return { checks, ok: false };
  }
  checks.push({ name: "rl.json exists", status: "pass", detail: opts.rlPath });

  let rl: RateLimits | null;
  try {
    rl = JSON.parse(await Bun.file(opts.rlPath).text());
  } catch {
    rl = null;
  }

  if (!rl) {
    checks.push({
      name: "rl.json parses",
      status: "fail",
      detail: "not valid JSON",
      remediation: RECORDER_REMEDIATION,
    });
    checks.push(statusline, binary);
    return { checks, ok: false };
  }
  checks.push({ name: "rl.json parses", status: "pass", detail: "valid JSON" });

  const fivePct = rl.five_hour?.used_percentage;
  if (typeof fivePct !== "number") {
    checks.push({
      name: "five_hour.used_percentage",
      status: "fail",
      detail: "missing or non-numeric; the alert hook stays silent on this data",
      remediation: RECORDER_REMEDIATION,
    });
  } else {
    checks.push({ name: "five_hour.used_percentage", status: "pass", detail: `${fivePct}%` });
  }

  checks.push(checkFreshness("rl.json freshness", rlMtime, opts));
  checks.push(...(await checkHistory(rl, opts)));
  checks.push(statusline, binary);

  const ok = !checks.some((c) => c.status === "fail");
  return { checks, ok };
}
