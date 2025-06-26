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
    
    expect(prompt).toContain('CLAUDE.md');
    expect(prompt).toContain('IMPORTANT: Respond ONLY with a JSON object');
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
    
    expect(prompt).toContain('CLAUDE.md');
    expect(prompt).toContain('mock diff content');
  });
});