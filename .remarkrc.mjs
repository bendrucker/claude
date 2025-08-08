import remarkFrontmatter from 'remark-frontmatter';
import remarkLintFrontmatterSchema from 'remark-lint-frontmatter-schema';

const remarkConfig = {
	plugins: [
		remarkFrontmatter,
		[
			remarkLintFrontmatterSchema,
			{
				schemas: {
					'.claude/commands/schema.json': [
						'.claude/commands/*.md'
					]
				}
			}
		]
	],
};

export default remarkConfig;
