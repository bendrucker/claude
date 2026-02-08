import { reportAndExit, validateFile } from "./validate";

async function main() {
	const file = ".claude-plugin/marketplace.json";

	console.log(`• ${file}`);

	const result = await validateFile(file, "schemas/marketplace.schema.json");

	console.log("");
	reportAndExit(result);
	console.log("Validation passed.");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
