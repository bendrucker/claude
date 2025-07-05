#!/usr/bin/env npx tsx

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

async function main() {
  await yargs(hideBin(process.argv))
    .command('install [mcp]', 'Install MCP servers', 
      (yargs) => {
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
      },
      async (argv) => {
        const { install } = await import('./install.js');
        await install(argv);
      }
    )
    .demandCommand(1, 'You need to specify a command')
    .strict()
    .help()
    .parseAsync();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}