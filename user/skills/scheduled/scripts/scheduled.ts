#!/usr/bin/env bun
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { cli, command } from "cleye";
import { table } from "table";
import { z } from "zod";
import { decode, decodeFile } from "../../../../packages/decode/index";

export const LABEL_ROOT = "me.bendrucker.claude";
const LAUNCH_AGENTS_DIR = join(homedir(), "Library/LaunchAgents");
const CONFIG_PATH = join(homedir(), ".config/claude-scheduled/config.json");

const WEEKDAYS: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

export const Mode = z.enum(["headless", "agent-view", "cloud"], {
  error: (issue) => `unknown "mode" ${JSON.stringify(issue.input)}`,
});
export type Mode = z.infer<typeof Mode>;

// An absent key and an empty value are the same authoring mistake.
function required(field: string) {
  const error = `missing "${field}"`;
  return z.string({ error }).min(1, { error });
}

export const Schedule = z.object(
  {
    weekday: z.string({ error: '"schedule.weekday" must be a string' }).optional(),
    day: z.number({ error: '"schedule.day" must be a number' }).optional(),
    at: required("schedule.at"),
  },
  { error: 'missing "schedule.at"' },
);
export type Schedule = z.infer<typeof Schedule>;

export const Descriptor = z.object({
  label: required("label"),
  schedule: Schedule,
  mode: Mode,
  command: required("command"),
  workdir: z.string({ error: '"workdir" must be a string' }).optional(),
  permission_mode: z.string({ error: '"permission_mode" must be a string' }).optional(),
});
export type Descriptor = z.infer<typeof Descriptor>;

export interface DescriptorFile {
  descriptor: Descriptor;
  file: string;
}

const Config = z.object({
  version: z.number(),
  groups: z.array(z.object({ name: z.string(), dir: z.string() })),
});
type Config = z.infer<typeof Config>;

export interface ReconcilePlan {
  install: string[];
  update: string[];
  prune: string[];
}

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

export function fullLabel(group: string, label: string): string {
  return `${LABEL_ROOT}.${group}.${label}`;
}

export function groupPrefix(group: string): string {
  return `${LABEL_ROOT}.${group}.`;
}

function shortLabel(group: string, label: string): string {
  return `${group}.${label}`;
}

/**
 * Diffs a group's desired descriptor labels against its currently-installed
 * agents. `installed` may span multiple groups; `prefix` (from `groupPrefix`)
 * scopes the diff so a group can never prune another group's agents.
 */
export function planReconcile(
  desired: string[],
  installed: string[],
  prefix: string,
): ReconcilePlan {
  const match = prefix.match(new RegExp(`^${LABEL_ROOT.replace(/\./g, "\\.")}\\.([^.]+)\\.$`));
  if (!match) throw new Error(`prefix must look like "${LABEL_ROOT}.<group>.", got "${prefix}"`);
  const group = match[1];

  const scopedInstalled = installed.filter((l) => l.startsWith(`${group}.`));
  const desiredSet = new Set(desired);
  const installedSet = new Set(scopedInstalled);

  return {
    install: desired.filter((l) => !installedSet.has(l)),
    update: [],
    prune: scopedInstalled.filter((l) => !desiredSet.has(l)),
  };
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function plistString(value: string): string {
  return `<string>${xmlEscape(value)}</string>`;
}

/** Renders a descriptor's launchd plist. Only `mode: headless` is buildable today. */
export function renderPlist(descriptor: Descriptor, group: string): string {
  if (descriptor.mode !== "headless") {
    throw new Error(`renderPlist only supports mode "headless", got "${descriptor.mode}"`);
  }
  if (!descriptor.workdir) {
    throw new Error(`descriptor "${descriptor.label}" is missing "workdir"`);
  }

  const label = fullLabel(group, descriptor.label);
  const workdir = expandHome(descriptor.workdir);
  const permissionMode = descriptor.permission_mode ?? "acceptEdits";
  const invocation = `claude -p ${JSON.stringify(descriptor.command)} --permission-mode ${permissionMode}`;
  const home = homedir();
  const stdout = join(home, "Library/Logs", `claude-${group}-${descriptor.label}.log`);
  const stderr = join(home, "Library/Logs", `claude-${group}-${descriptor.label}.err.log`);

  const [hourStr, minuteStr] = descriptor.schedule.at.split(":");
  const hour = Number.parseInt(hourStr ?? "", 10);
  const minute = Number.parseInt(minuteStr ?? "", 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error(
      `descriptor "${descriptor.label}" has an invalid schedule.at "${descriptor.schedule.at}", expected "HH:MM"`,
    );
  }

  const intervalKeys: string[] = [];
  if (descriptor.schedule.weekday) {
    const weekday = WEEKDAYS[descriptor.schedule.weekday];
    if (weekday === undefined) {
      throw new Error(
        `descriptor "${descriptor.label}" has an unknown weekday "${descriptor.schedule.weekday}"`,
      );
    }
    intervalKeys.push(`\t\t<key>Weekday</key>\n\t\t<integer>${weekday}</integer>`);
  }
  if (descriptor.schedule.day !== undefined) {
    intervalKeys.push(`\t\t<key>Day</key>\n\t\t<integer>${descriptor.schedule.day}</integer>`);
  }
  intervalKeys.push(`\t\t<key>Hour</key>\n\t\t<integer>${hour}</integer>`);
  intervalKeys.push(`\t\t<key>Minute</key>\n\t\t<integer>${minute}</integer>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t${plistString(label)}
\t<key>ProgramArguments</key>
\t<array>
\t\t<string>/bin/zsh</string>
\t\t<string>-lc</string>
\t\t${plistString(invocation)}
\t</array>
\t<key>WorkingDirectory</key>
\t${plistString(workdir)}
\t<key>StartCalendarInterval</key>
\t<dict>
${intervalKeys.join("\n")}
\t</dict>
\t<key>StandardOutPath</key>
\t${plistString(stdout)}
\t<key>StandardErrorPath</key>
\t${plistString(stderr)}
\t<key>ProcessType</key>
\t<string>Background</string>
</dict>
</plist>
`;
}

export function parseDescriptor(text: string, source: string): Descriptor {
  return decode(Descriptor, Bun.YAML.parse(text), source);
}

export async function listDescriptors(dir: string): Promise<DescriptorFile[]> {
  const glob = new Bun.Glob("*.{yaml,yml}");
  const results: DescriptorFile[] = [];
  for await (const file of glob.scan({ cwd: dir, absolute: true })) {
    results.push({ descriptor: parseDescriptor(await Bun.file(file).text(), file), file });
  }
  return results.toSorted((a, b) => a.descriptor.label.localeCompare(b.descriptor.label));
}

/** Short-form (`<group>.<label>`) identifiers for every `me.bendrucker.claude.*` agent installed on this machine. */
async function listInstalledLabels(): Promise<string[]> {
  const pattern = new RegExp(`^${LABEL_ROOT.replace(/\./g, "\\.")}\\.([^.]+)\\.(.+)\\.plist$`);
  const glob = new Bun.Glob(`${LABEL_ROOT}.*.*.plist`);
  const labels: string[] = [];
  for await (const file of glob.scan({ cwd: LAUNCH_AGENTS_DIR })) {
    const match = file.match(pattern);
    if (match?.[1] && match[2]) labels.push(shortLabel(match[1], match[2]));
  }
  return labels;
}

async function loadConfig(): Promise<Config> {
  const file = Bun.file(CONFIG_PATH);
  if (!(await file.exists())) {
    throw new Error(
      `no group directories given and no config at ${CONFIG_PATH}; run /scheduled setup or pass directories explicitly`,
    );
  }
  return decodeFile(Config, CONFIG_PATH);
}

async function resolveGroups(dirs: string[]): Promise<{ group: string; dir: string }[]> {
  if (dirs.length > 0) {
    return dirs.map((dir) => {
      const resolved = resolve(dir);
      return { group: basename(resolved), dir: resolved };
    });
  }
  const config = await loadConfig();
  return config.groups.map((g) => {
    const dir = expandHome(g.dir);
    return { group: basename(dir), dir };
  });
}

function requireUid(): number {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("launchd control requires macOS");
  return uid;
}

async function installDescriptor(descriptor: Descriptor, group: string): Promise<boolean> {
  const uid = requireUid();
  const label = fullLabel(group, descriptor.label);
  const dest = join(LAUNCH_AGENTS_DIR, `${label}.plist`);
  const xml = renderPlist(descriptor, group);

  Bun.spawnSync(["launchctl", "bootout", `gui/${uid}/${label}`]);
  await Bun.write(dest, xml);

  for (let attempt = 0; attempt < 5; attempt++) {
    const result = Bun.spawnSync(["launchctl", "bootstrap", `gui/${uid}`, dest]);
    if (result.exitCode === 0) break;
    await Bun.sleep(500);
  }

  return Bun.spawnSync(["launchctl", "print", `gui/${uid}/${label}`]).exitCode === 0;
}

async function pruneAgent(group: string, label: string): Promise<void> {
  const uid = requireUid();
  const full = fullLabel(group, label);
  Bun.spawnSync(["launchctl", "bootout", `gui/${uid}/${full}`]);
  await rm(join(LAUNCH_AGENTS_DIR, `${full}.plist`), { force: true });
}

async function changedContent(entry: DescriptorFile, group: string): Promise<boolean> {
  const dest = join(LAUNCH_AGENTS_DIR, `${fullLabel(group, entry.descriptor.label)}.plist`);
  const file = Bun.file(dest);
  if (!(await file.exists())) return false;
  return (await file.text()) !== renderPlist(entry.descriptor, group);
}

async function syncGroups(dirs: string[], dryRun: boolean): Promise<void> {
  const groups = await resolveGroups(dirs);
  const installedAll = await listInstalledLabels();
  const rows: string[][] = [["GROUP", "LABEL", "ACTION"]];
  const failures: string[] = [];

  for (const { group, dir } of groups) {
    const entries = await listDescriptors(dir);
    const headless = entries.filter((e) => e.descriptor.mode === "headless");
    for (const skipped of entries.filter((e) => e.descriptor.mode !== "headless")) {
      console.log(
        `skip ${group}.${skipped.descriptor.label}: mode "${skipped.descriptor.mode}" is reserved, not yet backed by a reconciler`,
      );
    }

    const byShortLabel = new Map(
      headless.map((e) => [shortLabel(group, e.descriptor.label), e] as const),
    );
    const desired = [...byShortLabel.keys()];
    const plan = planReconcile(desired, installedAll, groupPrefix(group));

    const install = [...plan.install];
    const update: string[] = [];
    for (const label of desired) {
      if (install.includes(label)) continue;
      const entry = byShortLabel.get(label);
      if (entry && (await changedContent(entry, group))) update.push(label);
    }

    const display = (label: string) => label.slice(group.length + 1);
    for (const label of install) rows.push([group, display(label), "install"]);
    for (const label of update) rows.push([group, display(label), "update"]);
    for (const label of plan.prune) rows.push([group, display(label), "prune"]);

    if (!dryRun) {
      for (const label of [...install, ...update]) {
        const entry = byShortLabel.get(label);
        if (entry && !(await installDescriptor(entry.descriptor, group))) {
          failures.push(fullLabel(group, entry.descriptor.label));
        }
      }
      for (const label of plan.prune) {
        await pruneAgent(group, label.slice(group.length + 1));
      }
    }
  }

  console.log(table(rows));
  if (dryRun) {
    console.log("dry run: no launchctl calls made");
    return;
  }
  if (failures.length > 0) {
    for (const label of failures) {
      console.error(`error: ${label} failed to bootstrap after retries`);
    }
    process.exit(1);
  }
}

function scheduleSummary(schedule: Schedule): string {
  const day = schedule.weekday ?? (schedule.day !== undefined ? `day ${schedule.day}` : "daily");
  return `${day} ${schedule.at}`;
}

async function listCommand(dirs: string[], withLoadState: boolean): Promise<void> {
  const uid = withLoadState ? process.getuid?.() : undefined;
  const groups = await resolveGroups(dirs);
  const installedAll = await listInstalledLabels();
  const header = ["GROUP", "LABEL", "DECLARED", "INSTALLED"];
  if (withLoadState) header.push("LOADED");
  header.push("SCHEDULE");
  const rows: string[][] = [header];

  for (const { group, dir } of groups) {
    const entries = await listDescriptors(dir);
    const declared = new Map(
      entries.map((e) => [shortLabel(group, e.descriptor.label), e] as const),
    );
    const installedForGroup = new Set(installedAll.filter((l) => l.startsWith(`${group}.`)));
    const all = new Set([...declared.keys(), ...installedForGroup]);

    for (const label of [...all].toSorted()) {
      const entry = declared.get(label);
      const installed = installedForGroup.has(label);
      const row = [
        group,
        label.slice(group.length + 1),
        entry ? "yes" : "no",
        installed ? "yes" : "no",
      ];
      if (withLoadState) {
        const loaded =
          installed && uid !== undefined
            ? Bun.spawnSync([
                "launchctl",
                "print",
                `gui/${uid}/${fullLabel(group, label.slice(group.length + 1))}`,
              ]).exitCode === 0
            : false;
        row.push(installed ? (loaded ? "yes" : "no") : "-");
      }
      row.push(entry ? scheduleSummary(entry.descriptor.schedule) : "-");
      rows.push(row);
    }
  }

  console.log(table(rows));
}

function resolveFullLabel(input: string): string {
  if (input.startsWith(`${LABEL_ROOT}.`)) return input;
  const dot = input.indexOf(".");
  if (dot < 0)
    throw new Error(`expected "<group>.<label>" or a full launchd label, got "${input}"`);
  return fullLabel(input.slice(0, dot), input.slice(dot + 1));
}

async function runCommand(labelArg: string): Promise<void> {
  const uid = requireUid();
  const label = resolveFullLabel(labelArg);
  const result = Bun.spawnSync(["launchctl", "kickstart", `gui/${uid}/${label}`], {
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(result.exitCode ?? 1);
}

if (import.meta.main) {
  const syncCmd = command(
    {
      name: "sync",
      parameters: ["[dirs...]"],
      help: { description: "Reconcile launchd agents against descriptor directories" },
      flags: {
        dryRun: {
          type: Boolean,
          description: "Print the install/update/prune plan without touching launchctl",
        },
      },
    },
    async (parsed) => {
      await syncGroups(parsed._.dirs, parsed.flags.dryRun ?? false);
    },
  );

  const listCmd = command(
    {
      name: "list",
      parameters: ["[dirs...]"],
      help: { description: "Show declared vs. installed agents" },
    },
    async (parsed) => {
      await listCommand(parsed._.dirs, false);
    },
  );

  const statusCmd = command(
    {
      name: "status",
      parameters: ["[dirs...]"],
      help: { description: "Show declared vs. installed agents, including launchd load state" },
    },
    async (parsed) => {
      await listCommand(parsed._.dirs, true);
    },
  );

  const runCmd = command(
    {
      name: "run",
      parameters: ["<label>"],
      help: {
        description:
          "Kickstart an installed agent immediately (<group>.<label> or full launchd label)",
      },
    },
    async (parsed) => {
      await runCommand(parsed._.label);
    },
  );

  cli(
    {
      name: "scheduled",
      commands: [syncCmd, listCmd, statusCmd, runCmd],
    },
    (parsed) => {
      parsed.showHelp();
    },
  );
}
