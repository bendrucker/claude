export type EvalMode = 'diff' | 'all';

export interface EvalOptions {
  mode: EvalMode;
  verbose: boolean;
  model?: string;
}

export interface EvalContext {
  mode: EvalMode;
  files: string[];
  prompt: string;
  verbose: boolean;
}