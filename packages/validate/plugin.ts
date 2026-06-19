import { pluginDirFile, runEntry, runValidation } from "./run";

runEntry(() =>
  runValidation({
    files: [
      pluginDirFile(
        "Usage: bun packages/validate/plugin.ts <plugin-dir>",
        ".claude-plugin/plugin.json",
      ),
    ],
    schema: { overlay: "plugin" },
    warnAdditional: true,
  }),
);
