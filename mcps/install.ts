#!/usr/bin/env npx tsx

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { homedir } from 'os';
import { McpConfigManager, type ClaudeDesktopConfig } from './config.js';

// Timer constants
const TIMER_LOAD_CONFIG = 'Load ~/.claude.json';
const TIMER_WRITE_CONFIG = 'Write ~/.claude.json';

class McpInstaller {
  private configManager: McpConfigManager;

  constructor() {
    this.configManager = new McpConfigManager();
  }

  async init(): Promise<void> {
    await this.configManager.init();
  }

  async printConfig(): Promise<void> {
    try {
      const desktopConfig = await this.configManager.generateClaudeDesktopConfig();
      console.log(JSON.stringify(desktopConfig, null, 2));
    } catch (error) {
      console.error('Error generating config:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }

  async install(targetMcp?: string): Promise<void> {
    const claudeConfigPath = join(homedir(), '.claude.json');

    // Load existing config
    console.time(TIMER_LOAD_CONFIG);
    let claudeConfig: ClaudeDesktopConfig;
    try {
      const content = await readFile(claudeConfigPath, 'utf-8');
      claudeConfig = JSON.parse(content);
      console.timeEnd(TIMER_LOAD_CONFIG);
    } catch {
      claudeConfig = { mcpServers: {} };
      console.timeEnd(TIMER_LOAD_CONFIG);
    }

    // If targetMcp is specified, find and install only that MCP
    if (targetMcp) {
      const foundMcp = this.configManager.find(targetMcp);
      if (!foundMcp) {
        console.error(`Error: MCP '${targetMcp}' not found.`);
        console.error('Available MCPs:');
        this.configManager.list().forEach(name => console.error(`  ${name}`));
        process.exit(1);
      }

      const { type, config } = foundMcp;

      try {
        const processedConfig = await this.configManager.process(type, config);
        claudeConfig.mcpServers[targetMcp] = processedConfig;
        console.log(`Configured MCP server: ${targetMcp}`);
      } catch (error) {
        console.error(`Failed to process MCP server '${targetMcp}':`, error);
        process.exit(1);
      }
    } else {
      // Process all configs (existing behavior)
      try {
        const generatedConfig = await this.configManager.generateClaudeDesktopConfig();
        claudeConfig.mcpServers = generatedConfig.mcpServers;
        Object.keys(generatedConfig.mcpServers).forEach(name => 
          console.log(`Configured MCP server: ${name}`)
        );
      } catch (error) {
        console.error('Failed to process MCP servers:', error);
        process.exit(1);
      }
    }

    // Write back to file
    console.time(TIMER_WRITE_CONFIG);
    await writeFile(claudeConfigPath, JSON.stringify(claudeConfig, null, 2));
    console.timeEnd(TIMER_WRITE_CONFIG);
  }
}

async function main() {
  const args = await yargs(hideBin(process.argv))
    .command('$0 [mcp]', 'Install MCP servers', (yargs) => {
      return yargs
        .positional('mcp', {
          describe: 'Name of specific MCP to install (installs all if not specified)',
          type: 'string'
        })
        .option('print', {
          type: 'boolean',
          description: 'Print MCP configuration as JSON (compatible with Claude Desktop)',
          default: false
        });
    })
    .help()
    .parseAsync();

  try {
    const installer = new McpInstaller();
    await installer.init();

    if (args.print) {
      await installer.printConfig();
    } else {
      await installer.install(args.mcp as string | undefined);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { McpConfigManager };