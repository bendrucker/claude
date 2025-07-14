import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

interface InstallArgs {
  directory: string;
  mcp?: string;
  print?: boolean;
  app: string[];
}

interface ToolsArgs {
  directory: string;
  server?: string;
  exclude?: string[];
}

interface ValidateArgs {
  directory: string;
}

async function main() {
  await yargs(hideBin(process.argv))
    .command('install <directory> [mcp]', 'Install MCP servers', 
      (yargs) => {
        return yargs
          .positional('directory', {
            describe: 'Directory containing mcps.json (and optionally docker-compose.yml)',
            type: 'string'
          })
          .positional('mcp', {
            describe: 'Name of specific MCP to install (installs all if not specified)',
            type: 'string'
          })
          .option('print', {
            type: 'boolean',
            description: 'Print MCP configuration as JSON (compatible with Claude Desktop)',
            default: false
          })
          .option('app', {
            type: 'string',
            description: 'Target application (claude-code, claude-desktop)',
            array: true,
            default: ['claude-code', 'claude-desktop']
          });
      },
      async (argv) => {
        const { install } = await import('../commands/install.js');
        await install(argv as InstallArgs);
      }
    )
    .command('tools <directory>', 'List available tools from MCP servers',
      (yargs) => {
        return yargs
          .positional('directory', {
            describe: 'Directory containing mcps.json',
            type: 'string'
          })
          .option('server', {
            describe: 'Name of specific MCP server to query (queries all if not specified)',
            type: 'string'
          })
          .option('exclude', {
            describe: 'MCP server to exclude (can be specified multiple times)',
            type: 'string',
            array: true
          });
      },
      async (argv) => {
        const { tools } = await import('../commands/tools.js');
        await tools(argv as ToolsArgs);
      }
    )
    .command('validate <directory>', 'Validate MCP configuration against JSON schema',
      (yargs) => {
        return yargs
          .positional('directory', {
            describe: 'Directory containing mcps.json',
            type: 'string'
          });
      },
      async (argv) => {
        const { validate } = await import('../commands/validate.js');
        await validate(argv as ValidateArgs);
      }
    )
    .demandCommand(1, 'You need to specify a command')
    .strict()
    .help()
    .parseAsync();
}

// Always run main when this module is imported
main().catch(error => {
  console.error('Error:', error instanceof Error ? error.message : error);
  process.exit(1);
});