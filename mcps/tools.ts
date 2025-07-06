import { readFile, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { Tools } from './lib/discovery.js';
import type { Configs } from './lib/config.js';
import { createServerConfig } from './lib/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function tools(argv: { name?: string; exclude?: string[] }): Promise<void> {
  try {
    // Load config
    const configPath = join(__dirname, 'mcps.json');
    await access(configPath);
    const configData = await readFile(configPath, 'utf-8');
    const configs: Configs = JSON.parse(configData);
    
    // Convert configs to ServerConfig format
    const serverConfigs: Record<string, any> = {};
    for (const [name, server] of Object.entries(configs)) {
      if (!server || !server.runner) continue;
      serverConfigs[name] = createServerConfig(server.runner);
    }
    
    // Create discovery with processed configs
    const discovery = new Tools(serverConfigs);
    const allServers = discovery.getServers();
    
    let serversToQuery = allServers;
    
    // Filter by name if specified
    if (argv.name) {
      serversToQuery = allServers.filter(s => s.name === argv.name);
      if (serversToQuery.length === 0) {
        console.error(`MCP '${argv.name}' not found. Available MCPs: ${allServers.map(s => s.name).join(', ')}`);
        process.exit(1);
      }
    }
    
    // Exclude servers if specified
    if (argv.exclude && argv.exclude.length > 0) {
      serversToQuery = serversToQuery.filter(s => !argv.exclude!.includes(s.name));
    }
    
    const results = await discovery.queryServersParallel(serversToQuery);
    
    // Print results
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    if (successful.length > 0) {
      for (const result of successful) {
        console.log(chalk.green(result.name));
        if (result.tools && result.tools.length > 0) {
          for (const tool of result.tools) {
            console.log(`  - ${tool}`);
          }
        } else {
          console.log('  (no tools)');
        }
        console.log();
      }
    }

    if (failed.length > 0) {
      console.log('Failed servers:');
      for (const result of failed) {
        console.log(`${chalk.red(result.name)}: ${result.error}`);
      }
    }
    
    const hasFailures = results.some(r => !r.success);
    if (hasFailures) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}