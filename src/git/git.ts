import simpleGit from 'simple-git';
import { SimpleGit } from 'simple-git';

export interface GitDiffInfo {
  file: string;
  diff: string;
  lineRanges: string[];
}

export class GitOperations {
  private git: SimpleGit;
  
  constructor() {
    this.git = simpleGit();
  }
  
  async getChangedConfigFiles(): Promise<string[]> {
    try {
      const diff = await this.git.diff([
        '--name-only', 
        'main...HEAD', 
        '--', 
        '.claude/**', 
        'CLAUDE.md'
      ]);
      return diff.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }
  
  async getAllConfigFiles(): Promise<string[]> {
    try {
      const files = await this.git.raw([
        'ls-files', 
        '.claude/**/*.md', 
        '.claude/**/*.json', 
        'CLAUDE.md'
      ]);
      return files.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }
  
  async getFileDiffInfo(file: string): Promise<GitDiffInfo> {
    try {
      const [diff, lineRanges] = await Promise.all([
        this.git.diff(['main...HEAD', '--', file]),
        this.getLineRanges(file)
      ]);
      
      return { file, diff, lineRanges };
    } catch {
      return { file, diff: '', lineRanges: [] };
    }
  }
  
  private async getLineRanges(file: string): Promise<string[]> {
    try {
      const diff = await this.git.diff([
        'main...HEAD', 
        '--unified=0', 
        '--', 
        file
      ]);
      
      return diff
        .split('\n')
        .filter(line => line.startsWith('@@'))
        .map(line => line.replace(/^@@ /, 'Line range: '));
    } catch {
      return ['No specific line ranges found'];
    }
  }
}