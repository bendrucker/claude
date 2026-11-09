import { Command } from "@commander-js/extra-typings";
import { type Corpus, type Direction, filters, key, PROFILES } from "./bucket";
import { s3, type S3Options, type Storage } from "./storage";

export async function sync(corpus: Corpus, direction: Direction, storage: Storage): Promise<void> {
  await Promise.all(
    corpus.mirrors.map((mirror) =>
      storage.copy(direction, mirror.local, key(corpus, mirror), filters(mirror)),
    ),
  );
}

function leaf(corpus: Corpus, direction: Direction, storage: (options: S3Options) => Storage) {
  return new Command(direction)
    .description(
      direction === "pull"
        ? `Copy ${corpus.description} from the eval bucket.`
        : `Upload ${corpus.description} to the eval bucket.`,
    )
    .option("--profile <name>", "AWS profile", PROFILES[direction])
    .option("--no-profile", "use the credentials in the environment")
    .option("--dry-run", "print what would change")
    .action(async (options) => {
      await sync(corpus, direction, storage(options));
      if (direction === "pull" && !options.dryRun) await corpus.afterPull?.();
    });
}

/** `sync pull|push` for one corpus, against S3 unless a test passes another storage. */
export function syncCommand(
  corpus: Corpus,
  storage: (options: S3Options) => Storage = s3,
): Command {
  return new Command("sync")
    .description(`Mirror ${corpus.description} between this checkout and the eval bucket.`)
    .addCommand(leaf(corpus, "pull", storage))
    .addCommand(leaf(corpus, "push", storage));
}
