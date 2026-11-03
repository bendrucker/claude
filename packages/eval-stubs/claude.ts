import { record, unavailable } from "./calls";

const argv = process.argv.slice(2);
await record("claude", argv);
unavailable("claude", argv);
