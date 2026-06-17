import { runEntry, runValidation } from "./run";

// Valid Claude Code settings that the schemastore schema does not yet list.
// Without this allowlist, warnAdditional flags them as unknown properties.
// Drop entries as schemastore adds them: https://github.com/SchemaStore/schemastore
const knownUnlistedSettings = [
  "theme",
  "autoCompactEnabled",
  "skipWorkflowUsageWarning",
  "skipAutoPermissionPrompt",
  "preferredNotifChannel",
  "inputNeededNotifEnabled",
  "agentPushNotifEnabled",
];

runEntry(() =>
  runValidation({
    files: [".claude/settings.json", "user/settings.json"],
    schema: "https://www.schemastore.org/claude-code-settings.json",
    warnAdditional: true,
    allowAdditional: knownUnlistedSettings,
    successMessage: "All validations passed.",
  }),
);
