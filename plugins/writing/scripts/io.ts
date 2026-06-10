/**
 * Shared I/O utilities for writing skill CLI scripts.
 *
 * readInput resolves in order: file path argument, inline text argument, stdin.
 * It is used by both scan and score so the three-way resolution stays consistent.
 */
export async function readInput(
  arg: string | undefined,
): Promise<{ text: string; filePath?: string }> {
  if (arg && (await Bun.file(arg).exists())) {
    return { text: await Bun.file(arg).text(), filePath: arg };
  }
  if (arg) {
    return { text: arg };
  }
  return { text: await new Response(Bun.stdin.stream()).text() };
}
