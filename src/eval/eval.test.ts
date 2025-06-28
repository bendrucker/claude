import { describe, it, expect } from 'vitest';
import { Evaluator } from './evaluator';
import { MockClaudeClient } from '../claude/mock';
import { EvalStatus } from './result';
import { GitOperations } from '../git/git';

describe('Evaluator', () => {
  it('should return success status for clean config', async () => {
    const client = new MockClaudeClient('testdata/mock_responses/clean_config.json');
    const evaluator = new Evaluator(client);
    
    const result = await evaluator.run({ mode: 'all', verbose: false });
    
    expect(result.status).toBe(EvalStatus.Success);
    expect(result.content).toContain('no issues');
    expect(result.response?.issues).toHaveLength(0);
  });
  
  it('should return violations status for config issues', async () => {
    const client = new MockClaudeClient('testdata/mock_responses/json_syntax_error.json');
    const evaluator = new Evaluator(client);
    
    const result = await evaluator.run({ mode: 'all', verbose: false });
    
    expect(result.status).toBe(EvalStatus.Violations);
    expect(result.content).toContain('syntax error');
    expect(result.response?.issues).toHaveLength(1);
    expect(result.response?.issues?.[0].type).toBe('syntax');
  });
  
  it('should return error status for Claude failures', async () => {
    const client = new MockClaudeClient('testdata/mock_responses/claude_error.json');
    const evaluator = new Evaluator(client);
    
    const result = await evaluator.run({ mode: 'all', verbose: false });
    
    expect(result.status).toBe(EvalStatus.Error);
    expect(result.content).toContain('system error');
  });
  
  it('should return no-files status when no files to evaluate', async () => {
    // Mock git operations to return empty array
    const mockGit: Pick<GitOperations, 'getChangedConfigFiles' | 'getAllConfigFiles' | 'getFileDiffInfo'> = {
      getAllConfigFiles: async () => [],
      getChangedConfigFiles: async () => [],
      getFileDiffInfo: async () => ({ file: '', diff: '', lineRanges: [] })
    };
    
    const client = new MockClaudeClient('testdata/mock_responses/clean_config.json');
    const evaluator = new Evaluator(client, mockGit as GitOperations);
    
    const result = await evaluator.run({ mode: 'diff', verbose: false });
    
    expect(result.status).toBe(EvalStatus.NoFiles);
  });
  
  it('should handle multiple issues correctly', async () => {
    const client = new MockClaudeClient('testdata/mock_responses/multiple_issues.json');
    const evaluator = new Evaluator(client);
    
    const result = await evaluator.run({ mode: 'all', verbose: false });
    
    expect(result.status).toBe(EvalStatus.Violations);
    expect(result.response?.issues).toHaveLength(3);
    
    const issues = result.response?.issues || [];
    expect(issues[0].severity).toBe('error');
    expect(issues[1].severity).toBe('warning');
    expect(issues[2].severity).toBe('info');
  });
});
