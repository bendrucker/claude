import { describe, it, expect } from 'vitest';
import { PromptBuilder } from './builder';
import { GitOperations } from '../git/git';

describe('PromptBuilder', () => {
  it('should build prompt for all mode', async () => {
    const builder = new PromptBuilder();
    
    const prompt = await builder.build({
      mode: 'all',
      files: ['CLAUDE.md']
    });
    
    expect(prompt).toContain('# Files');
    expect(prompt).toContain('## Configuration files:');
    expect(prompt).toContain('CLAUDE.md');
    expect(prompt).toContain('# Response Format');
    expect(prompt).toContain('"status": "success"');
  });
  
  it('should build prompt for diff mode', async () => {
    const mockGit: Pick<GitOperations, 'getFileDiffInfo' | 'getAllConfigFiles' | 'getChangedConfigFiles'> = {
      getFileDiffInfo: async (file: string) => ({
        file,
        diff: 'mock diff content',
        lineRanges: ['Line range: 1,5 +1,6']
      }),
      getAllConfigFiles: async () => [],
      getChangedConfigFiles: async () => []
    };
    
    const builder = new PromptBuilder(mockGit as GitOperations);
    
    const prompt = await builder.build({
      mode: 'diff',
      files: ['CLAUDE.md']
    });
    
    expect(prompt).toContain('# Files');
    expect(prompt).toContain('## Changed files:');
    expect(prompt).toContain('CLAUDE.md');
    expect(prompt).toContain('Changed line ranges:');
    expect(prompt).toContain('# Response Format');
  });
  
  it('should include JSON schema in prompt', async () => {
    const builder = new PromptBuilder();
    
    const prompt = await builder.build({
      mode: 'all',
      files: []
    });
    
    expect(prompt).toContain('You must respond with valid JSON');
    expect(prompt).toContain('"status": "success" | "violations" | "error"');
    expect(prompt).toContain('"type": "syntax" | "reference" | "security"');
    expect(prompt).toContain('Rules:');
  });
});