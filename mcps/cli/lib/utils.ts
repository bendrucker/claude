import { access, constants } from 'fs/promises';
import { join } from 'path';

export async function validateDirectory(directory: string): Promise<void> {
  try {
    // Check if directory exists
    await access(directory, constants.F_OK);
    
    // Check if mcps.json exists
    const mcpsPath = join(directory, 'mcps.json');
    await access(mcpsPath, constants.F_OK);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'ENOENT') {
        const mcpsPath = join(directory, 'mcps.json');
        try {
          await access(mcpsPath, constants.F_OK);
        } catch {
          throw new Error(`Directory '${directory}' does not contain required mcps.json file`);
        }
        throw new Error(`Directory '${directory}' does not exist`);
      }
    }
    throw error;
  }
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}