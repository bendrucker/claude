import { describe, it, expect } from 'vitest';
import { GitOperations } from './git';

describe('GitOperations', () => {
  it('should return changed config files', async () => {
    const git = new GitOperations();
    
    // This test will work when there are actual changes
    const files = await git.getChangedConfigFiles();
    
    expect(Array.isArray(files)).toBe(true);
    // Each file should be a valid path
    files.forEach(file => {
      expect(typeof file).toBe('string');
      expect(file.length).toBeGreaterThan(0);
    });
  });
  
  it('should return all config files', async () => {
    const git = new GitOperations();
    
    const files = await git.getAllConfigFiles();
    
    expect(Array.isArray(files)).toBe(true);
    // Should include at least CLAUDE.md if it exists
    if (files.length > 0) {
      const hasClaudeFile = files.some(file => file.includes('CLAUDE.md') || file.includes('.claude/'));
      expect(hasClaudeFile).toBe(true);
    }
  });
  
  it('should return diff info for a file', async () => {
    const git = new GitOperations();
    
    const diffInfo = await git.getFileDiffInfo('CLAUDE.md');
    
    expect(diffInfo).toHaveProperty('file');
    expect(diffInfo).toHaveProperty('diff');
    expect(diffInfo).toHaveProperty('lineRanges');
    expect(diffInfo.file).toBe('CLAUDE.md');
    expect(Array.isArray(diffInfo.lineRanges)).toBe(true);
  });
});
