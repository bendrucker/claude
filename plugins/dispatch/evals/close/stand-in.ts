import { record } from "../../../../packages/eval-stubs/calls";

const argv = process.argv.slice(2);
await record("claude-dispatch-close", argv);

const pane = { mux: "rex", target: "block:sender" };
const [command] = argv;
if (command === "close" || command === "park" || command === "restore") {
  process.stdout.write(`${JSON.stringify({ pane })}\n`);
  process.exit(0);
}
process.stderr.write(`claude-dispatch-close stand-in: ${argv.join(" ")} is unavailable\n`);
process.exit(1);
