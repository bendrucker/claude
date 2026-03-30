import { join } from "node:path";
import { reportAndExit, validateFile } from "./validate";

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: bun packages/validate/plugin.ts <plugin-dir>");
    process.exit(1);
  }

  const file = join(dir, ".claude-plugin/plugin.json");
  console.log(`• ${file}`);

  const result = await validateFile(file, "schemas/plugin.schema.json", {
    warnAdditional: true,
  });
  console.log("");
  reportAndExit(result);
  console.log("Validation passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
