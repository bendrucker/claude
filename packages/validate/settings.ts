import { runEntry, runValidation } from "./run";

runEntry(() =>
  runValidation({
    files: [".claude/settings.json", "user/settings.json"],
    schema: "https://www.schemastore.org/claude-code-settings.json",
    warnAdditional: true,
    successMessage: "All validations passed.",
  }),
);
