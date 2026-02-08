import { reportAndExit, validateFile } from "./validate";

async function main() {
	const pluginDir = process.argv[2];
	if (!pluginDir) {
		console.error("Usage: validate/plugin.ts <plugin-dir>");
		process.exit(1);
	}

	const file = `${pluginDir}/.claude-plugin/plugin.json`;

	console.log(`Validating ${file}...`);

	const result = await validateFile(file, "schemas/plugin.schema.json");

	reportAndExit(result);
	console.log("Validation passed.");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
