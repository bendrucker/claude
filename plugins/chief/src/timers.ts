const RELEASE_INTERVAL_MS = 60_000;
const FLOCK_INTERVAL_MS = 20 * 60_000;

export type Schedule = (fn: () => void, ms: number) => () => void;

const REAL_SCHEDULE: Schedule = (fn, ms) => {
  const id = setInterval(fn, ms);
  return () => clearInterval(id);
};

export interface TimersDeps {
  releaseCheck: () => void | Promise<void>;
  flockTick: () => void | Promise<void>;
  workHours: [string, string];
  now?: () => Date;
  schedule?: Schedule;
}

export interface TimersHandle {
  stop: () => void;
}

function minutesOf(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

export function isWorkHours(now: Date, workHours: [string, string]): boolean {
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= minutesOf(workHours[0]) && minutes < minutesOf(workHours[1]);
}

export function start(deps: TimersDeps): TimersHandle {
  const now = deps.now ?? (() => new Date());
  const schedule = deps.schedule ?? REAL_SCHEDULE;

  const cancelRelease = schedule(() => {
    void deps.releaseCheck();
  }, RELEASE_INTERVAL_MS);

  const cancelFlock = schedule(() => {
    if (isWorkHours(now(), deps.workHours)) void deps.flockTick();
  }, FLOCK_INTERVAL_MS);

  return {
    stop: () => {
      cancelRelease();
      cancelFlock();
    },
  };
}
