export function schedule(items: string[]): void {
  items.forEach(async (item) => {
    await Promise.resolve(item);
  });
}
