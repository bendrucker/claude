import { join } from "node:path";
import { record, recordLaunch, type Status, status, stubDir, unavailable } from "./calls";

async function nextBlock(): Promise<string> {
  const file = Bun.file(join(stubDir, "rex-count"));
  const last = (await file.exists()) ? Number(await file.text()) : 0;
  const count = Number.isFinite(last) ? last + 1 : 1;
  await Bun.write(file, String(count));
  return `block:eval-${count}`;
}

function print(value: unknown): never {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  process.exit(0);
}

const argv = process.argv.slice(2);
await record("rex", argv);

// A leading `-S <server>` addresses another machine and changes nothing offline.
const words = argv[0] === "-S" ? argv.slice(2) : argv;
const [first, second] = words;

function after(flag: string, offset = 1): string | undefined {
  const at = words.indexOf(flag);
  return at === -1 ? undefined : words[at + offset];
}

if (first === "whoami" && words.includes("--json")) print({ tailscale: null });
if ((first === "window" && second === "new") || first === "split") {
  const cwd = after("-c");
  const label = first === "split" ? after("--label") : after("-s", 2);
  if (cwd !== undefined) await recordLaunch(cwd, first === "split" ? "pane" : "tab", label ?? "");
  print({ block_ids: [await nextBlock()] });
}
if (first === "block" && second === "inspect" && words.includes("--json"))
  print({ session_id: "session:eval", block: { block_id: words[2], window_id: "window:eval" } });
if (first === "block" && second === "call" && words.includes("size"))
  print({ columns: 200, rows: 50 });
if (first === "block" && second === "call" && words.includes("program_status")) {
  const { state, kind, msg } = await status();
  const reported: Status = { state };
  if (kind !== undefined) reported.kind = kind;
  if (msg !== undefined) reported.msg = msg;
  print({ records: [{ ...reported, effective_app: "claude-code" }] });
}
if (first === "capture") process.exit(0);
if ((first === "hosts" && second === "list") || first === "ls")
  print([{ name: "local", address: "local", state: "connected" }]);
unavailable("rex", argv);
