export const settings = { retries: 1, retries: 2 };

export function schedule(items: string[]): void {
  items.forEach(async (item) => {
    await Promise.resolve(item);
  });
}
