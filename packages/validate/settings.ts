import { type ValidationResult, reportAndExit, validateFile } from "./validate";

const schema = "https://www.schemastore.org/claude-code-settings.json";

const files = [".claude/settings.json", "user/settings.json"];

async function main() {
  const result: ValidationResult = { errors: [], warnings: [] };

  for (const file of files) {
    console.log(`• ${file}`);
    const r = await validateFile(file, schema, { warnAdditional: true });
    result.errors.push(...r.errors);
    result.warnings.push(...r.warnings);
  }

  console.log("");
  reportAndExit(result);
  console.log("All validations passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
