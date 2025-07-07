import { readFile, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function validate(): Promise<void> {
  try {
    const schemaDir = join(__dirname, 'schema');
    
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
    await access(schemaPath);
    const schemaData = await readFile(schemaPath, 'utf-8');
    const schema = JSON.parse(schemaData);

    // Load the config
    const configPath = join(__dirname, 'mcps.json');
    await access(configPath);
    const configData = await readFile(configPath, 'utf-8');
    const config = JSON.parse(configData);

    // Compile and validate
    const validate = await ajv.compileAsync(schema);
    const valid = validate(config.servers);

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
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}