#!/usr/bin/env bun

import { loadPlugins, loadSettings } from "../packages/marketplace/index";
import { runCheck } from "./check";

/** The marketplace `.claude-plugin/marketplace.json` publishes. */
const OWN = "bendrucker";

export interface PluginId {
  name: string;
  marketplace: string;
}

/**
 * Splits an `enabledPlugins` key into its plugin name and marketplace, or null
 * when it does not carry both. Claude Code silently ignores a key it cannot
 * resolve, so a malformed one disables the plugin without saying so.
 */
export function parseId(id: string): PluginId | null {
  const at = id.lastIndexOf("@");
  if (at <= 0 || at === id.length - 1) return null;
  return { name: id.slice(0, at), marketplace: id.slice(at + 1) };
}

export interface Sources {
  /** Every key of `enabledPlugins`, in file order. */
  ids: string[];
  /** Marketplace keys declared in `extraKnownMarketplaces`. */
  marketplaces: Set<string>;
  /** Plugin names this repo's marketplace offers. */
  listed: Set<string>;
}

/**
 * Enabled ids that cannot resolve.
 *
 * Third-party names are unverifiable offline: resolving them means fetching
 * each remote marketplace manifest, so those ids are checked only as far as
 * their marketplace being declared.
 */
export function violations({ ids, marketplaces, listed }: Sources): string[] {
  const messages: string[] = [];

  for (const id of ids) {
    const parsed = parseId(id);
    if (!parsed) {
      messages.push(`${id}: not of the form <plugin>@<marketplace>`);
      continue;
    }
    if (!marketplaces.has(parsed.marketplace)) {
      messages.push(`${id}: marketplace "${parsed.marketplace}" is not in extraKnownMarketplaces`);
      continue;
    }
    if (parsed.marketplace === OWN && !listed.has(parsed.name)) {
      messages.push(`${id}: no plugin named "${parsed.name}" in .claude-plugin/marketplace.json`);
    }
  }

  return messages;
}

export async function sources(): Promise<Sources> {
  const [settings, plugins] = await Promise.all([loadSettings(), loadPlugins()]);
  return {
    ids: Object.keys(settings.enabledPlugins ?? {}),
    marketplaces: new Set(Object.keys(settings.extraKnownMarketplaces ?? {})),
    listed: new Set(plugins.filter((plugin) => plugin.listing).map((plugin) => plugin.name)),
  };
}

if (import.meta.main) {
  await runCheck(
    async () => ({
      header: "Enabled plugins that do not resolve:",
      violations: violations(await sources()),
    }),
    { success: "Every enabled plugin id resolves" },
  );
}
