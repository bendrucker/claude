#!/usr/bin/env node

import { cli, command } from 'cleye';
import { Evaluator } from './eval/evaluator';
import { ClaudeClient } from './claude/client';
import { EvalStatus } from './eval/result';
import { EvalOptions } from './eval/types';
import * as log from './log';

// Define subcommands
const runCommand = command({
  name: 'run',
  description: 'Evaluate configuration files',
  flags: {
    diff: {
      type: Boolean,
      description: 'Only evaluate changed files (default)',
      default: true
    },
    all: {
      type: Boolean,
      description: 'Evaluate all configuration files',
      alias: 'a'
    },
    verbose: {
      type: Boolean,
      description: 'Verbose output for debugging',
      alias: 'v'
    },
    model: {
      type: String,
      description: 'Specific Claude model name'
    },
    'model-family': {
      type: String,
      description: 'Claude model family to use'
    }
  }
});

const listModelsCommand = command({
  name: 'list-models',
  description: 'List available Claude models'
});

const argv = cli({
  name: 'claude-eval',
  description: 'Evaluate Claude configuration changes',
  version: '1.0.0',
  flags: {
    debug: {
      type: Boolean,
      description: 'Enable debug logging',
      alias: 'd'
    }
  },
  commands: [
    runCommand,
    listModelsCommand
  ]
});

async function main() {
  // Enable debug logging if requested
  if ('debug' in argv.flags && argv.flags.debug) {
    log.setDebugEnabled(true);
  }

  const client = new ClaudeClient();

  // Handle commands
  if (argv.command === 'list-models') {
    try {
      const models = await client.getAvailableModels();
      if ('debug' in argv.flags && argv.flags.debug) {
        log.info('Available models', { type: 'models', models });
      } else {
        console.log('Available Claude models:');
        for (const model of models) {
          console.log(`  ${model.id} - ${model.display_name}`);
        }
      }
      process.exit(0);
    } catch (error) {
      log.error('Failed to list models', { type: 'models', error: String(error) });
      process.exit(1);
    }
  } else if (argv.command === 'run') {
    // Transform CLI flags to internal options
    const options: EvalOptions = {
      mode: 'all' in argv.flags && argv.flags.all ? 'all' : 'diff',
      verbose: Boolean('verbose' in argv.flags && argv.flags.verbose),
      model: ('model' in argv.flags && argv.flags.model) || ('model-family' in argv.flags && argv.flags['model-family']) || undefined
    };

    const evaluator = new Evaluator(client);
    const result = await evaluator.run(options);

    // All output as NDJSON when debug enabled, otherwise human readable
    if ('debug' in argv.flags && argv.flags.debug) {
      log.info('Evaluation completed', {
        type: 'result',
        status: result.status,
        issues: result.response?.issues?.length || 0,
        summary: result.response?.summary
      });
      
      if (result.response?.issues) {
        for (const issue of result.response.issues) {
          log.info(issue.message, {
            type: 'issue',
            file: issue.file,
            line: issue.line,
            severity: issue.severity,
            issueType: issue.type,
            suggestion: issue.suggestion
          });
        }
      }
    } else {
      // Human readable output
      if (result.response) {
        console.log(`\n${result.response.summary}`);
        
        if (result.response.issues && result.response.issues.length > 0) {
          console.log('\nIssues found:');
          for (const issue of result.response.issues) {
            const location = issue.line ? `${issue.file}:${issue.line}` : issue.file;
            const badge = issue.severity === 'error' ? '❌' : 
                         issue.severity === 'warning' ? '⚠️' : 'ℹ️';
            
            console.log(`  ${badge} ${location}: ${issue.message}`);
            if (issue.suggestion) {
              console.log(`    💡 ${issue.suggestion}`);
            }
          }
        }
        
        if ('verbose' in argv.flags && argv.flags.verbose && result.response.metadata) {
          console.log(`\nMetadata: ${JSON.stringify(result.response.metadata, null, 2)}`);
        }
      }
    }

    // CLI is responsible for exit code translation
    const exitCode = translateStatusToExitCode(result.status);

    if ('debug' in argv.flags && argv.flags.debug) {
      log.info('Process exiting', { type: 'exit', status: result.status, exitCode });
    } else if ('verbose' in argv.flags && argv.flags.verbose) {
      console.error(`Status: ${result.status}, Exit Code: ${exitCode}`);
    }

    process.exit(exitCode);
  } else {
    // Default to evaluate command if no command specified
    console.error('Usage: claude-eval <command>');
    console.error('Commands: run, list-models');
    process.exit(1);
  }
}

// Only run if this module is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
}

function translateStatusToExitCode(status: EvalStatus): number {
  switch (status) {
    case EvalStatus.Success:
    case EvalStatus.NoFiles:
      return 0; // Success
    case EvalStatus.Violations:
      return 2; // Violations found
    case EvalStatus.Error:
      return 1; // System error
    default:
      return 1; // Unknown status treated as error
  }
}
