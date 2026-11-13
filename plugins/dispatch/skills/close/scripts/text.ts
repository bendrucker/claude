export function present(value: string | undefined): value is string {
  return value != null && value !== "";
}

export function trimmed(text: string): string | null {
  const value = text.trim();
  return value === "" ? null : value;
}
