import remarkFrontmatter from 'remark-frontmatter';
import remarkLintFrontmatterSchema from 'remark-lint-frontmatter-schema';

const remarkConfig = {
	plugins: [
		remarkFrontmatter,
		[
			remarkLintFrontmatterSchema,
			{
				schemas: {
					'.claude/agents/schema.json': [
						'.claude/agents/*.md'
					],
					'.claude/commands/schema.json': [
						'.claude/commands/*.md'
					],
					'.claude/skills/schema.json': [
						'.claude/skills/*/SKILL.md'
					]
				}
			}
		]
	],
};

export default remarkConfig;
