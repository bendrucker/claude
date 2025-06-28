import { GitOperations } from '../git/git';
import { PromptBuilder } from '../prompt/builder';
import { ClaudeClientInterface } from '../claude/interface';
import { EvalOptions, EvalContext } from './types';
import { EvalResult, EvalStatus } from './result';
import * as log from '../log';

export class Evaluator {
  constructor(
    private claude: ClaudeClientInterface,
    private git = new GitOperations(),
    private promptBuilder = new PromptBuilder()
  ) {}
  
  async run(options: EvalOptions): Promise<EvalResult> {
    try {
      log.debug('Starting evaluation', { type: 'evaluator', options });
      const context = await this.buildContext(options);
      
      log.debug('Built context', { 
        type: 'evaluator-context',
        mode: context.mode, 
        fileCount: context.files.length,
        files: context.files 
      });
      
      if (options.verbose) {
        console.error(`Mode: ${context.mode}`);
        console.error(`Files: ${context.files.join(', ')}`);
      }
      
      if (context.files.length === 0) {
        log.info('No files to evaluate', { type: 'evaluator' });
        return {
          status: EvalStatus.NoFiles,
          context
        };
      }
      
      log.debug('Sending prompt to Claude', { type: 'evaluator-prompt', prompt: context.prompt });
      const claudeResult = await this.claude.evaluate(context.prompt, options.model);
      
      log.debug('Received Claude result', { 
        type: 'evaluator-result',
        status: claudeResult.status,
        hasResponse: !!claudeResult.response 
      });
      
      return {
        status: claudeResult.status,
        content: claudeResult.content,
        context,
        response: claudeResult.response
      };
    } catch (error) {
      log.error('Evaluation failed', { type: 'evaluator', error: String(error) });
      const context = await this.buildContext(options).catch(() => ({
        mode: options.mode,
        files: [],
        prompt: '',
        verbose: options.verbose
      }));
      
      return {
        status: EvalStatus.Error,
        context,
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }
  
  private async buildContext(options: EvalOptions): Promise<EvalContext> {
    const files = options.mode === 'all' 
      ? await this.git.getAllConfigFiles()
      : await this.git.getChangedConfigFiles();
    
    const prompt = await this.promptBuilder.build({
      mode: options.mode,
      files
    });
    
    return {
      mode: options.mode,
      files,
      prompt,
      verbose: options.verbose
    };
  }
}
