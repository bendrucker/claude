import { ClaudeEvalResponse } from '../claude/types';
import { EvalContext } from './types';

export enum EvalStatus {
  Success = 'success',
  Violations = 'violations',
  Error = 'error',
  NoFiles = 'no-files'
}

export interface EvalResult {
  status: EvalStatus;
  content?: string;
  context: EvalContext;
  response?: ClaudeEvalResponse;
  error?: Error;
}

export interface ClaudeResult {
  content: string;
  status: EvalStatus;
  response: ClaudeEvalResponse;
}