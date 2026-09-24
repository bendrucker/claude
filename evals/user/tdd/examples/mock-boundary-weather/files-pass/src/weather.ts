export async function summary(
  city: string,
  get: Get = fetchJson,
): Promise<string> {
