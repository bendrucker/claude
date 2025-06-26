import { ClaudeResult } from '../eval/result';

export interface ClaudeClientInterface {
  evaluate(prompt: string, model?: string): Promise<ClaudeResult>;
}