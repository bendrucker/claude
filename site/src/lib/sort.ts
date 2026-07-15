export type SortKey = "name" | "category" | "updated";

export const SORT_KEYS: SortKey[] = ["name", "category", "updated"];

const SORT_LABELS: Record<SortKey, string> = {
  name: "Name",
  category: "Category",
  updated: "Recently updated",
};

export function sortLabel(key: SortKey): string {
  return `Sort: ${SORT_LABELS[key]}`;
}
