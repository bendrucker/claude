export interface IgnorePattern {
  regex: RegExp;
  label: string;
}

export interface LanguageConfig {
  extensions: string[];
  patterns: IgnorePattern[];
}

export const LANGUAGES: Record<string, LanguageConfig> = {
  typescript: {
    extensions: ["ts", "tsx", "js", "jsx", "mjs", "cjs"],
    patterns: [
      { regex: /@ts-ignore/, label: "@ts-ignore" },
      { regex: /@ts-expect-error/, label: "@ts-expect-error" },
      { regex: /eslint-disable(?:-next-line)?/, label: "eslint-disable" },
      { regex: /biome-ignore/, label: "biome-ignore" },
    ],
  },
  python: {
    extensions: ["py", "pyi"],
    patterns: [
      { regex: /#\s*type:\s*ignore/, label: "type: ignore" },
      { regex: /#\s*noqa/, label: "noqa" },
      { regex: /#\s*pylint:\s*disable/, label: "pylint: disable" },
    ],
  },
  go: {
    extensions: ["go"],
    patterns: [
      { regex: /\/\/nolint/, label: "nolint" },
      { regex: /\/\/lint:ignore/, label: "lint:ignore" },
    ],
  },
  rust: {
    extensions: ["rs"],
    patterns: [{ regex: /#!?\[allow\([^\]]+\)\]/, label: "#[allow(...)]" }],
  },
  ruby: {
    extensions: ["rb"],
    patterns: [{ regex: /#\s*rubocop:disable/, label: "rubocop:disable" }],
  },
};

export const EXTENSION_MAP = new Map<string, string>();
for (const [language, config] of Object.entries(LANGUAGES)) {
  for (const ext of config.extensions) {
    EXTENSION_MAP.set(ext, language);
  }
}

export const TARGET_EXTENSIONS = new Set(EXTENSION_MAP.keys());
