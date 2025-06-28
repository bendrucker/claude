import { readFile } from 'fs/promises';
import { GitOperations } from '../git/git';
import { EvalMode } from '../eval/types';

export interface PromptContext {
  mode: EvalMode;
  files: string[];
}

export class PromptBuilder {
  constructor(private git = new GitOperations()) {}
  
  async build(context: PromptContext): Promise<string> {
    const sections = [
      await this.buildFilesSection(context),
      await this.buildInstructionsSection(context.mode),
      this.buildJsonSchema()
    ];
    
    return sections.join('\n\n');
  }
  
  private async buildFilesSection(context: PromptContext): Promise<string> {
    if (context.mode === 'all') {
      return this.buildAllFilesSection(context.files);
    } else {
      return this.buildDiffFilesSection(context.files);
    }
  }
  
  private async buildAllFilesSection(files: string[]): Promise<string> {
    const fileContents = await Promise.all(
      files.map(async (file) => {
        try {
          const content = await readFile(file, 'utf8');
          return `### ${file}\n\`\`\`\n${content}\n\`\`\``;
        } catch {
          return `### ${file}\n(Could not read file)`;
        }
      })
    );
    
    return `# Files\n\n## Configuration files:\n${files.join('\n')}\n\n## File contents:\n\n${fileContents.join('\n\n')}`;
  }
  
  private async buildDiffFilesSection(files: string[]): Promise<string> {
    const diffInfos = await Promise.all(
      files.map(file => this.git.getFileDiffInfo(file))
    );
    
    const diffSections = diffInfos.map(info => 
      `### ${info.file}\n\nChanged line ranges:\n${info.lineRanges.join('\n')}\n\n\`\`\`diff\n${info.diff}\n\`\`\`\n`
    );
    
    return `# Files\n\n## Changed files:\n${files.join('\n')}\n\n## Changed file diffs with line ranges:\n\n${diffSections.join('\n')}`;
  }
  
  private async buildInstructionsSection(mode: EvalMode): Promise<string> {
    const [baseInstructions, modeInstructions] = await Promise.all([
      readFile('evals/instructions.md', 'utf8'),
      readFile(mode === 'all' ? 'evals/all.md' : 'evals/diff.md', 'utf8')
    ]);
    
    return `${modeInstructions}\n\n${baseInstructions}`;
  }
  
  private buildJsonSchema(): string {
    return `
IMPORTANT: Respond ONLY with a JSON object. Do not use markdown formatting.

{
  "status": "success" | "violations" | "error",
  "summary": "Brief overall assessment",
  "issues": [
    {
      "file": "path/to/file",
      "line": 123,
      "type": "syntax" | "reference" | "security" | "style" | "other",
      "severity": "error" | "warning" | "info", 
      "message": "Description of the issue",
      "suggestion": "How to fix it (optional)"
    }
  ],
  "metadata": {
    "filesEvaluated": 5,
    "evaluationTime": "2025-06-26T17:33:23Z"
  }
}`;
  }
}
