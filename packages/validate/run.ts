import { join, resolve } from "node:path";
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
  if (target.extraSchemas != null && target.extraSchemas.length > 0) {
    ajv = createValidator();
    const extras = await Promise.all(
      target.extraSchemas.map(async (extra) => ({
        key: extra.key,
        schema: await loadSchema(extra.schema),
      })),
    );
    for (const extra of extras) {
      ajv.addSchema(extra.schema, extra.key);
    }
  }

  const options: { ajv?: Ajv; warnAdditional?: boolean } = {};
  if (ajv) options.ajv = ajv;
  if (target.warnAdditional) options.warnAdditional = true;

  const result: ValidationResult = { errors: [], warnings: [] };
  for (const file of target.files) {
    // oxlint-disable-next-line no-await-in-loop -- each file prints its bullet as it is validated, so the checks follow the printed order.
    if (!(await Bun.file(resolve(file)).exists())) {
      console.log(`• ${file} (not found, skipped)`);
      continue;
    }
    console.log(`• ${file}`);
    // oxlint-disable-next-line no-await-in-loop -- each file prints its bullet as it is validated, so the checks follow the printed order.
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
  if (dir == null || dir === "") {
    console.error(usage);
    process.exit(1);
  }
  return join(dir, file);
}

export function runEntry(run: () => Promise<void>): void {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
