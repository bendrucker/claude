import remarkFrontmatter from 'remark-frontmatter';
import remarkLintFrontmatterSchema from 'remark-lint-frontmatter-schema';

const remarkConfig = {
	plugins: [
		remarkFrontmatter,
		[
			remarkLintFrontmatterSchema,
			{
				schemas: {
					'schemas/agent.schema.json': [
						'.claude/agents/*.md'
					],
					'schemas/command.schema.json': [
						'.claude/commands/*.md'
					],
					'schemas/skill.schema.json': [
						'.claude/skills/*/SKILL.md'
					]
				}
			}
		]
	],
};

export default remarkConfig;
