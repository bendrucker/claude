import { readFile } from 'fs/promises';
import { ClaudeResult, EvalStatus } from '../eval/result';
import { ClaudeEvalResponse } from './types';
import { ClaudeClientInterface } from './interface';

export class MockClaudeClient implements ClaudeClientInterface {
  constructor(private responseFile: string) {}
  
  async evaluate(prompt: string): Promise<ClaudeResult> {
    try {
      const response: ClaudeEvalResponse = JSON.parse(
        await readFile(this.responseFile, 'utf8')
      );
      
      // Simulate streaming to stdout
      process.stdout.write(response.summary);
      
      return {
        content: response.summary,
        status: this.mapStatus(response.status),
        response
      };
    } catch (error) {
      throw new Error(`Mock evaluation failed: ${error}`);
    }
  }
  
  private mapStatus(status: string): EvalStatus {
    switch (status) {
      case 'success': return EvalStatus.Success;
      case 'violations': return EvalStatus.Violations;
      case 'error': return EvalStatus.Error;
      default: return EvalStatus.Error;
    }
  }
}
