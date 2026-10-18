import { type Machine, PRESSURE_CRITICAL, PRESSURE_WARN } from "./caps";

/** 0 calm, 1 busy, 2 strained. */
export type Level = 0 | 1 | 2;

export interface Thresholds {
  /** Load per core that makes the machine busy; 0 turns pacing off. */
  busy: number;
  /** Load per core that makes it strained; 0 leaves only memory pressure. */
  strained: number;
}

export function level(machine: Machine, { busy, strained }: Thresholds): Level {
  if (busy <= 0) return 0;
  const load = machine.loadPerCore ?? 0;
  const pressure = machine.pressure ?? 0;
  if (pressure >= PRESSURE_CRITICAL || (strained > 0 && load >= strained)) return 2;
  if (pressure >= PRESSURE_WARN || load >= busy) return 1;
  return 0;
}

const PRESSURE = new Map([
  [PRESSURE_WARN, "warning"],
  [PRESSURE_CRITICAL, "critical"],
]);

function describe(machine: Machine): string {
  const facts: string[] = [];
  if (machine.loadPerCore !== undefined) {
    facts.push(`load ${machine.loadPerCore.toFixed(1)}x its cores`);
  }
  const pressure = PRESSURE.get(machine.pressure ?? 0);
  if (pressure !== undefined) facts.push(`${pressure} memory pressure`);
  if (machine.sessions > 1) facts.push(`${machine.sessions} Claude sessions`);
  if (machine.running.length > 0) facts.push(`running ${machine.running.join(", ")}`);
  return facts.join("; ");
}

/** Guidance for the model, or undefined when the machine is calm. */
export function reminder(machine: Machine, grade: Level): string | undefined {
  if (grade === 0) return undefined;
  const facts = describe(machine);
  if (grade === 1) {
    return `This machine is busy (${facts}), so the user is likely doing other work on it. Before starting heavy work (builds, test suites, browsers, data jobs), weigh how much it matters to the task now: defer what can wait, prefer targeted tests over full suites, lower worker and thread counts, run one job at a time, and prefix long jobs with \`nice\`.`;
  }
  return `This machine is strained (${facts}) and everything on it is slowing down. Start no heavy work the current task does not need. Finish in-flight work with the smallest jobs that will do, one at a time, with minimal worker and thread counts.`;
}
