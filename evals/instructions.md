## Claude Configuration Evaluation Instructions

You are reviewing changes to a Claude Code configuration repository. Focus only on the changed files and their immediate context.

### Review Criteria

Review the changes for:
1. Syntax errors in markdown files
2. Broken references (e.g., @memory/tools/nonexistent.md)
3. Inconsistencies in tool documentation
4. Security concerns (exposed secrets, unsafe practices)
5. Style guide violations per .claude/CLAUDE.md

### Specific File Types

#### .claude/memory/tools:
- Verify command examples are correct
- Check that documentation is clear and actionable
- Ensure examples follow the user's style preferences

#### .claude/CLAUDE.md:
- Verify style preferences are consistent
- Check that tool references exist
- Ensure instructions are clear and unambiguous

#### .claude/*.json:
- Verify JSON syntax is valid
- Check for exposed secrets or API keys
- Ensure paths and references are correct

### Guidelines

- Provide specific, actionable feedback
- Be concise and focus only on actual issues
- Do not comment on unchanged portions of files
- Use inline annotations when possible
- Prioritize security and functionality issues over style preferences
