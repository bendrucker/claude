`bun run import` reads 107 contacts and imports 100. `chunk` loops while `i + size <= items.length`, so the final partial batch of 7 never gets pushed. Looping while `i < items.length` keeps it.
