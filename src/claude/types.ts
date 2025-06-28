export interface ClaudeEvalResponse {
  status: 'success' | 'violations' | 'error';
  summary: string;
  issues?: Issue[];
  metadata?: {
    filesEvaluated: number;
    evaluationTime?: string;
  };
}

export interface Issue {
  file: string;
  line?: number;
  type: 'syntax' | 'reference' | 'security' | 'style' | 'other';
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion?: string;
}
