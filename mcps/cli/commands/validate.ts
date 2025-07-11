import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { loadDir } from '../lib/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ValidateArgs {
  directory: string;
}

export async function validate(argv: ValidateArgs): Promise<void> {
  try {
    const schemaDir = join(__dirname, '..', 'schema');
    
    const ajv = new Ajv({ 
      allErrors: true, 
      verbose: true,
      loadSchema: async (uri: string) => {
        const schemaPath = join(schemaDir, uri);
        const schemaData = await readFile(schemaPath, 'utf-8');
        return JSON.parse(schemaData);
      }
    });
    addFormats(ajv);

    // Load the main schema
    const schemaPath = join(schemaDir, 'mcps.json');
    const schemaData = await readFile(schemaPath, 'utf-8');
    const schema = JSON.parse(schemaData);

    // Load the config
    const config = await loadDir(argv.directory);

    // Compile and validate
    const validate = await ajv.compileAsync(schema);
    const valid = validate(config);

    if (!valid) {
      console.error('Validation failed:');
      if (validate.errors) {
        for (const error of validate.errors) {
          const path = error.instancePath || 'root';
          console.error(`  ${path}: ${error.message}`);
          if (error.data !== undefined) {
            console.error(`    Received: ${JSON.stringify(error.data)}`);
          }
        }
      }
      process.exit(1);
    } else {
      console.log('✓ Configuration is valid');
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}