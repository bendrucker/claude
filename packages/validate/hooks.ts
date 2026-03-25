import { join } from "node:path";
import { createValidator, loadSchema, reportAndExit, validateFile } from "./validate";

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: bun packages/validate/hooks.ts <plugin-dir>");
    process.exit(1);
  }

  const file = join(dir, "hooks/hooks.json");
  console.log(`• ${file}`);

  const ajv = createValidator();
  const hookSchema = await loadSchema("schemas/hook.schema.json");
  ajv.addSchema(hookSchema, "hook.schema.json");

  const result = await validateFile(file, "schemas/plugin-hook.schema.json", { ajv });
  console.log("");
  reportAndExit(result);
  console.log("Validation passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
