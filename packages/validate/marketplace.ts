import { runEntry, runValidation } from "./run";

runEntry(() =>
  runValidation({
    files: [".claude-plugin/marketplace.json"],
    schema: { overlay: "marketplace" },
  }),
);
