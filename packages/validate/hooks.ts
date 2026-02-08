import { readFile } from "fs/promises";
import { createValidator, formatError, loadSchema, reportAndExit } from "./validate";

async function main() {
  const pluginDir = process.argv[2];
  if (!pluginDir) {
    console.error("Usage: validate/hooks.ts <plugin-dir>");
    process.exit(1);
  }

  const file = `${pluginDir}/hooks/hooks.json`;

  console.log(`Validating ${file}...`);

  const ajv = createValidator();

  const hooksSchema = await loadSchema("schemas/hook.schema.json");
  ajv.addSchema(hooksSchema);

  const pluginHooksSchema = await loadSchema("schemas/plugin-hook.schema.json");
  const validate = ajv.compile(pluginHooksSchema);

  const content = await readFile(file, "utf8");
  const data = JSON.parse(content);
  const valid = validate(data);

  if (!valid) {
    const errors = validate.errors!.map((err) => formatError(file, err));
    reportAndExit({ errors, warnings: [] });
  }

  console.log("Validation passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
