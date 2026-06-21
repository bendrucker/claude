import { join } from "node:path";
import type Ajv from "ajv";
import {
  createValidator,
  loadSchema,
  reportAndExit,
  type SchemaRef,
  type ValidationResult,
  validateFile,
} from "./validate";

export interface ValidationTarget {
  files: string[];
  schema: SchemaRef;
  warnAdditional?: boolean;
  extraSchemas?: { schema: string; key: string }[];
  successMessage?: string;
}

export async function runValidation(target: ValidationTarget): Promise<void> {
  let ajv: Ajv | undefined;
  if (target.extraSchemas?.length) {
    ajv = createValidator();
    for (const extra of target.extraSchemas) {
      ajv.addSchema(await loadSchema(extra.schema), extra.key);
    }
  }

  const options: { ajv?: Ajv; warnAdditional?: boolean } = {};
  if (ajv) options.ajv = ajv;
  if (target.warnAdditional) options.warnAdditional = true;

  const result: ValidationResult = { errors: [], warnings: [] };
  for (const file of target.files) {
    console.log(`• ${file}`);
    const r = await validateFile(file, target.schema, options);
    result.errors.push(...r.errors);
    result.warnings.push(...r.warnings);
  }

  console.log("");
  reportAndExit(result);
  console.log(target.successMessage ?? "Validation passed.");
}

export function pluginDirFile(usage: string, file: string): string {
  const dir = process.argv[2];
  if (!dir) {
    console.error(usage);
    process.exit(1);
  }
  return join(dir, file);
}

export function runEntry(run: () => Promise<void>): void {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
