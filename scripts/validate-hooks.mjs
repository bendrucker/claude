#!/usr/bin/env node

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFile } from 'fs/promises';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

function formatError(file, error) {
  const path = error.instancePath || '/';
  const message = `${path}: ${error.message}`;

  if (isCI) {
    return `::error file=${file}::${message}`;
  }
  return `  ${file}: ${message}`;
}

async function main() {
  const pluginDir = process.argv[2];
  if (!pluginDir) {
    console.error('Usage: validate-hooks.mjs <plugin-dir>');
    process.exit(1);
  }

  const file = `${pluginDir}/hooks/hooks.json`;

  console.log(`Validating ${file}...`);

  // Load and register the base hooks schema first
  const hooksSchemaContent = await readFile('schemas/hook.schema.json', 'utf8');
  const hooksSchema = JSON.parse(hooksSchemaContent);
  ajv.addSchema(hooksSchema);

  // Load and compile the plugin-hooks schema
  const pluginHooksSchemaContent = await readFile('schemas/plugin-hook.schema.json', 'utf8');
  const pluginHooksSchema = JSON.parse(pluginHooksSchemaContent);
  const validate = ajv.compile(pluginHooksSchema);

  const content = await readFile(file, 'utf8');
  const data = JSON.parse(content);
  const valid = validate(data);

  if (!valid) {
    console.log('Validation errors:\n');
    validate.errors.forEach(err => console.log(formatError(file, err)));
    process.exit(1);
  }

  console.log('Validation passed.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
