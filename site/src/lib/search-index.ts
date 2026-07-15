import type { Catalog } from "../data/catalog";

export interface SearchRecord {
  type: "plugin" | "skill";
  pluginName: string;
  /** Plugin name for a plugin record, `plugin:skill` for a skill record. */
  name: string;
  description: string;
  keywords: string[];
  /** Every record routes to its plugin's page; skills have no page of their own. */
  route: string;
}

/** Roughly 90 records (33 plugins + one per skill): small enough to ship the whole index to the client. */
export function buildSearchIndex(catalog: Catalog): SearchRecord[] {
  const records: SearchRecord[] = [];

  for (const plugin of catalog.plugins) {
    records.push({
      type: "plugin",
      pluginName: plugin.name,
      name: plugin.name,
      description: plugin.description ?? "",
      keywords: plugin.keywords,
      route: plugin.route,
    });

    for (const skill of plugin.skills) {
      records.push({
        type: "skill",
        pluginName: plugin.name,
        name: skill.name,
        description: skill.description,
        keywords: [],
        route: plugin.route,
      });
    }
  }

  return records;
}

export interface SearchMatch {
  record: SearchRecord;
  score: number;
}

const WEIGHTS = {
  nameStarts: 100,
  nameIncludes: 60,
  keyword: 40,
  descriptionIncludes: 15,
};

function scoreRecord(record: SearchRecord, query: string): number {
  const name = record.name.toLowerCase();
  const description = record.description.toLowerCase();

  let score = 0;
  if (name.startsWith(query)) score += WEIGHTS.nameStarts;
  else if (name.includes(query)) score += WEIGHTS.nameIncludes;

  if (record.keywords.some((keyword) => keyword.toLowerCase().includes(query))) {
    score += WEIGHTS.keyword;
  }

  if (description.includes(query)) score += WEIGHTS.descriptionIncludes;

  return score;
}

/** Weighted substring search over the index. At ~90 records fuzzy matching mostly adds false positives, so this stays plain substring scoring. */
export function search(records: SearchRecord[], query: string): SearchMatch[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  return records
    .map((record) => ({ record, score: scoreRecord(record, normalized) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score);
}
