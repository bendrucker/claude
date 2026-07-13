import { runEntry, runValidation } from "./run";

runEntry(() =>
  runValidation({
    files: [".claude/settings.json", "user/settings.json"],
    schema: { overlay: "settings" },
    warnAdditional: true,
    successMessage: "All validations passed.",
  }),
);
