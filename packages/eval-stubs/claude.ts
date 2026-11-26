import { join } from "node:path";
import { record, recordLaunch, status, stubDir, unavailable } from "./calls";

const COUNT = join(stubDir, "bg-count");

async function launched(): Promise<number> {
  const file = Bun.file(COUNT);
  const last = (await file.exists()) ? Number(await file.text()) : 0;
  return Number.isFinite(last) ? last : 0;
}

const argv = process.argv.slice(2);
await record("claude", argv);

if (argv[0] === "--bg") {
  const count = (await launched()) + 1;
  await Bun.write(COUNT, String(count));
  await recordLaunch(process.cwd(), "bg");
  process.stdout.write(`bg-eval-${count}\n`);
  process.exit(0);
}
const WAITING_FOR: Readonly<Record<string, string>> = {
  permission: "permission prompt",
  question: "input needed",
};

if (argv[0] === "agents" && argv.includes("--json")) {
  const count = await launched();
  const { state, kind } = await status();
  const waiting =
    state === "blocked" ? { status: "waiting", waitingFor: WAITING_FOR[kind ?? ""] } : {};
  const agents = Array.from({ length: count }, (_, i) => ({
    id: `bg-eval-${i + 1}`,
    state,
    ...waiting,
  }));
  process.stdout.write(`${JSON.stringify(agents)}\n`);
  process.exit(0);
}
unavailable("claude", argv);
