#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Command, InvalidArgumentError } from "@commander-js/extra-typings";

// A detached Rex session draws into a fixed grid with no resize, so the pty must fit inside it.
const GRID = { cols: 80, rows: 24 };

function int(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new InvalidArgumentError("Not a positive integer.");
  return n;
}

export type KeyAction =
  | { kind: "text"; value: string }
  | { kind: "key"; value: string[] }
  | { kind: "wait"; ms: number };

export function parseKeys(source: string): KeyAction[] {
  const actions: KeyAction[] = [];
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const space = line.indexOf(" ");
    const verb = space === -1 ? line : line.slice(0, space);
    const rest = space === -1 ? "" : line.slice(space + 1);
    if (verb === "text") actions.push({ kind: "text", value: rest });
    else if (verb === "key") actions.push({ kind: "key", value: rest.split(/\s+/) });
    else if (verb === "wait") actions.push({ kind: "wait", ms: int(rest) });
    else throw new Error(`unknown keys action: ${line}`);
  }
  return actions;
}

export function shellQuote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;
}

export function stripTrailing(text: string): string {
  return `${text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd()}\n`;
}

export function maxWidth(text: string): number {
  const graphemes = new Intl.Segmenter();
  return Math.max(0, ...text.split("\n").map((line) => [...graphemes.segment(line)].length));
}

export function page(
  html: string,
  cols: number,
  colors: { background: string; foreground: string },
  fontSize: number,
): string {
  return `<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; background: ${colors.background}; color: ${colors.foreground}; }
  body { padding: 16px; display: inline-block; }
  .screen {
    font-family: "MonaspiceAr Nerd Font Mono", "MonaspiceAr Nerd Font", "Symbols Nerd Font Mono", monospace;
    font-size: ${fontSize}px;
    line-height: 1.25;
    width: ${cols}ch;
    overflow: hidden;
    box-shadow: 0 0 0 1px rgba(128,128,128,.35);
  }
  .screen > div { font-family: inherit !important; }
</style>
<div class="screen">${html}</div>
`;
}

async function rex(args: string[]): Promise<string> {
  const proc = Bun.spawn(["rex", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`rex ${args.join(" ")}: ${err.trim()}`);
  return out;
}

async function browser(args: string[]): Promise<void> {
  const proc = Bun.spawn(["agent-browser", "--session", "tui-shot", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`agent-browser ${args.join(" ")}: ${err.trim()}`);
}

async function settle(session: string, timeoutMs: number, quietMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let previous = "";
  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- polling: each capture must follow the previous one.
    await Bun.sleep(quietMs);
    // oxlint-disable-next-line no-await-in-loop -- see above.
    const current = await rex(["capture", "-s", session, "--trim"]);
    if (current.trim() !== "" && current === previous) return;
    previous = current;
  }
  throw new Error(`screen did not settle within ${timeoutMs}ms`);
}

interface ShotOptions {
  cols: number;
  rows: number;
  name: string;
  keys?: string;
  out: string;
  background: string;
  foreground: string;
  timeout: number;
  quiet: number;
  fontSize: number;
}

export interface Shot {
  png: string;
  width: number;
}

export async function shoot(command: string[], options: ShotOptions): Promise<Shot> {
  if (options.cols > GRID.cols || options.rows > GRID.rows) {
    throw new Error(
      `pty ${options.cols}x${options.rows} exceeds Rex's detached grid ${GRID.cols}x${GRID.rows}`,
    );
  }
  const session = `tui-shot-${options.name}-${options.cols}`;
  const base = join(options.out, `${options.name}-${options.cols}`);
  await mkdir(options.out, { recursive: true });
  const actions = options.keys !== undefined ? parseKeys(await Bun.file(options.keys).text()) : [];
  const script = `stty cols ${options.cols} rows ${options.rows}; exec ${command.map(shellQuote).join(" ")}`;

  let text = "";
  await rex([
    "new",
    session,
    "--keep-open",
    "--cwd",
    process.cwd(),
    "--shell",
    "/bin/zsh",
    "--",
    "/bin/zsh",
    "-c",
    script,
  ]);
  try {
    await settle(session, options.timeout, options.quiet);
    // oxlint-disable no-await-in-loop -- keystrokes replay in order, each after the screen settles.
    // A `wait` stands in for settling, so a screen that keeps animating can still be caught mid-run.
    for (const [index, action] of actions.entries()) {
      if (action.kind === "text") await rex(["send", "-s", session, action.value]);
      else if (action.kind === "key") await rex(["send-key", "-s", session, ...action.value]);
      else await Bun.sleep(action.ms);
      if (action.kind !== "wait" && actions[index + 1]?.kind !== "wait") {
        await settle(session, options.timeout, options.quiet);
      }
    }
    // oxlint-enable no-await-in-loop
    text = stripTrailing(await rex(["capture", "-s", session, "--trim"]));
    const html = await rex(["capture", "-s", session, "--trim", "--format=html"]);
    await Bun.write(`${base}.txt`, text);
    await Bun.write(`${base}.html`, page(html, options.cols, options, options.fontSize));
  } finally {
    await rex(["kill", session]).catch(() => undefined);
  }

  const width = Math.ceil(options.cols * options.fontSize * 0.62) + 48;
  await browser(["open", `file://${resolve(`${base}.html`)}`]);
  await browser(["set", "viewport", String(width), "400"]);
  await browser(["screenshot", "--full", `${base}.png`]);
  return { png: `${base}.png`, width: maxWidth(text) };
}

export const program = new Command("tui-shot")
  .description("Render a TUI at a fixed pty size in a throwaway Rex session and screenshot it.")
  .option("--cols <n>", "pty columns", int, 45)
  .option("--rows <n>", "pty rows", int, GRID.rows)
  .requiredOption("--name <scenario>", "scenario name, used for the session and output files")
  .option("--keys <file>", "keys file: one `text <s>`, `key <k...>`, or `wait <ms>` per line")
  .option("--out <dir>", "output directory", "tmp/shots")
  .option("--background <css>", "page background behind the capture", "#1d1f21")
  .option("--foreground <css>", "default text color of the capture", "#c5c8c6")
  .option("--timeout <ms>", "settle timeout per step", int, 60000)
  .option("--quiet <ms>", "interval two matching captures must span", int, 1500)
  .option("--font-size <px>", "font size of the rendered capture", int, 15)
  .argument("<command...>", "command to run in the pty")
  .passThroughOptions()
  .action(async (command, options) => {
    const started = Date.now();
    let failure: string | undefined;
    let width: number | undefined;
    try {
      const shot = await shoot(command, options);
      width = shot.width;
      console.log(`${shot.png} width=${shot.width}${shot.width > options.cols ? " OVER" : ""}`);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      console.error(failure);
      process.exitCode = 1;
    } finally {
      const run = {
        scenario: options.name,
        cols: options.cols,
        width,
        ms: Date.now() - started,
        ok: failure === undefined,
        error: failure,
      };
      const log = Bun.file(join(options.out, "runs.jsonl"));
      const prior = (await log.exists()) ? await log.text() : "";
      await Bun.write(log, `${prior}${JSON.stringify(run)}\n`);
    }
  });

if (import.meta.main) {
  await program.parseAsync();
}
