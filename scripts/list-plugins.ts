import { readFileSync } from 'node:fs';

interface PluginEntry {
  name: string;
  source: string | { source: string; repo: string };
}

interface Marketplace {
  plugins: PluginEntry[];
}

const INFRASTRUCTURE_PATHS = [
  'schemas/',
  'scripts/',
  '.github/workflows/test.yml',
  '.claude-plugin/marketplace.json'
] as const;

function getLocalPlugins(): string[] {
  const content = readFileSync('.claude-plugin/marketplace.json', 'utf8');
  const marketplace: Marketplace = JSON.parse(content);
  return marketplace.plugins
    .filter((p): p is PluginEntry & { source: string } => typeof p.source === 'string')
    .map(p => p.name);
}

function extractPluginNames(files: string[]): string[] {
  const plugins = new Set<string>();
  for (const file of files) {
    const match = file.match(/^plugins\/([^/]+)\//);
    if (match?.[1]) plugins.add(match[1]);
  }
  return [...plugins];
}

function hasInfrastructureChanges(files: string[]): boolean {
  return files.some(file => INFRASTRUCTURE_PATHS.some(path => file.startsWith(path)));
}

function main(): void {
  const changedFiles = process.argv.slice(2);
  const allPlugins = getLocalPlugins();

  let plugins: string[];
  if (changedFiles.length > 0) {
    if (hasInfrastructureChanges(changedFiles)) {
      plugins = allPlugins;
    } else {
      const changedPlugins = extractPluginNames(changedFiles);
      plugins = allPlugins.filter(p => changedPlugins.includes(p));
    }
  } else {
    plugins = allPlugins;
  }

  console.log(JSON.stringify(plugins));
}

main();
