import { pluginDirFile, runEntry, runValidation } from "./run";

runEntry(() =>
  runValidation({
    files: [
      pluginDirFile("Usage: bun packages/validate/hooks.ts <plugin-dir>", "hooks/hooks.json"),
    ],
    schema: "schemas/plugin-hook.schema.json",
    extraSchemas: [{ schema: "schemas/hook.schema.json", key: "hook.schema.json" }],
  }),
);
