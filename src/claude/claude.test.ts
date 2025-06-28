import { describe, it, expect } from 'vitest';
import { MockClaudeClient } from './mock';
import { EvalStatus } from '../eval/result';

describe('ClaudeClient', () => {
  it('should parse success response correctly', async () => {
    const client = new MockClaudeClient('testdata/mock_responses/clean_config.json');
    
    const result = await client.evaluate('test prompt');
    
    expect(result.status).toBe(EvalStatus.Success);
    expect(result.response.status).toBe('success');
    expect(result.response.issues).toHaveLength(0);
  });
  
  it('should parse violations response correctly', async () => {
    const client = new MockClaudeClient('testdata/mock_responses/json_syntax_error.json');
    
    const result = await client.evaluate('test prompt');
    
    expect(result.status).toBe(EvalStatus.Violations);
    expect(result.response.status).toBe('violations');
    expect(result.response.issues).toHaveLength(1);
    expect(result.response.issues?.[0].file).toBe('.claude/settings.json');
  });
  
  it('should parse error response correctly', async () => {
    const client = new MockClaudeClient('testdata/mock_responses/claude_error.json');
    
    const result = await client.evaluate('test prompt');
    
    expect(result.status).toBe(EvalStatus.Error);
    expect(result.response.status).toBe('error');
  });
});
