const MARKETPLACE = "bendrucker";
const MARKETPLACE_REPO = "bendrucker/claude";

export type InstallScope = "user" | "project" | "local";

export const INSTALL_SCOPES: InstallScope[] = ["user", "project", "local"];

export interface InstallInstructions {
  marketplaceAdd: string;
  install: string;
  cli: Record<InstallScope, string>;
  settingsSnippet: string;
}

export function installInstructions(pluginName: string): InstallInstructions {
  const qualified = `${pluginName}@${MARKETPLACE}`;

  const cli = Object.fromEntries(
    INSTALL_SCOPES.map((scope) => [scope, `claude plugin install ${qualified} --scope ${scope}`]),
  ) as Record<InstallScope, string>;

  const settings = {
    extraKnownMarketplaces: {
      [MARKETPLACE]: {
        source: { source: "github", repo: MARKETPLACE_REPO },
      },
    },
    enabledPlugins: {
      [qualified]: true,
    },
  };

  return {
    marketplaceAdd: `/plugin marketplace add ${MARKETPLACE_REPO}`,
    install: `/plugin install ${qualified}`,
    cli,
    settingsSnippet: JSON.stringify(settings, null, 2),
  };
}
