#!/usr/bin/env node

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFile } from 'fs/promises';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const validatorCache = new Map();

function formatError(file, error) {
  const path = error.instancePath || '/';
  const message = `${path}: ${error.message}`;

  if (isCI) {
    return `::error file=${file}::${message}`;
  }
  return `  ${file}: ${message}`;
}

async function loadSchema(schemaPath) {
  if (schemaPath.startsWith('http')) {
    const response = await fetch(schemaPath);
    return response.json();
  }
  const content = await readFile(schemaPath, 'utf8');
  return JSON.parse(content);
}

async function getValidator(schemaPath) {
  if (validatorCache.has(schemaPath)) {
    return validatorCache.get(schemaPath);
  }
  const schema = await loadSchema(schemaPath);
  const validate = ajv.compile(schema);
  validatorCache.set(schemaPath, validate);
  return validate;
}

async function validateFile(file, schemaPath) {
  const validate = await getValidator(schemaPath);
  const content = await readFile(file, 'utf8');
  const data = JSON.parse(content);
  const valid = validate(data);

  if (!valid) {
    return validate.errors.map(err => formatError(file, err));
  }
  return [];
}

async function main() {
  const errors = [];

  console.log('Validating shared files...\n');

  console.log('• settings.json');
  errors.push(...await validateFile(
    '.claude/settings.json',
    'https://www.schemastore.org/claude-code-settings.json'
  ));

  console.log('• marketplace.json');
  errors.push(...await validateFile(
    '.claude-plugin/marketplace.json',
    'schemas/marketplace.schema.json'
  ));

  console.log('');

  if (errors.length > 0) {
    console.log('Validation errors:\n');
    errors.forEach(e => console.log(e));
    process.exit(1);
  }

  console.log('All validations passed.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
