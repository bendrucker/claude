import { runEntry, runValidation } from "./run";

runEntry(() =>
  runValidation({
    files: [".claude-plugin/marketplace.json"],
    schema: "schemas/marketplace.schema.json",
  }),
);
