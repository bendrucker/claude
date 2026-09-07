// Corpus A is agent-authored prose, corpus B one or more registers of the pre-agent voice baseline.

import { contrastCorpusPath, registerPaths, resolveDataDir, voiceBaselineDir } from "./data-dir";
import {
  DOCUMENT_KINDS,
  documentKind,
  type DocumentKind,
  isDocumentKind,
  readCorpus,
  type VoiceDocument,
} from "./voice-corpus";

const DEFAULT_BASELINES = ["github-prs.txt", "github-issues.txt"];

export const CORPUS_FLAGS = {
  dataDir: { type: String, description: "Override the plugin data directory" },
  study: {
    type: String,
    description: "Corpus A (agent-authored). Defaults to the contrast baseline.",
  },
  baseline: {
    type: [String],
    description: `Corpus B register filenames. Repeatable. Default: ${DEFAULT_BASELINES.join(", ")}`,
  },
  kind: {
    type: [String],
    description: `Corpus A document kinds to keep. Repeatable. One of ${DOCUMENT_KINDS.join(", ")}.`,
  },
  studyFilter: {
    type: String,
    description: "Narrow the kinds further to corpus A sources matching this regex",
  },
} as const;

export interface CorpusFlags {
  dataDir?: string | undefined;
  study?: string | undefined;
  baseline: string[];
  kind: string[];
  studyFilter?: string | undefined;
}

export interface StudyCorpus {
  path: string;
  kinds: DocumentKind[];
  documents: VoiceDocument[];
}

export interface BaselineCorpus {
  names: string[];
  paths: string[];
  documents: VoiceDocument[];
}

export interface CorpusSelection {
  study: StudyCorpus;
  baseline: BaselineCorpus;
  /** Every register on disk, reference and control alike. */
  registers: string[];
}

export async function selectCorpora(flags: CorpusFlags): Promise<CorpusSelection> {
  const dataDir = resolveDataDir(flags.dataDir);
  const studyPath = flags.study ?? contrastCorpusPath(dataDir);
  const baselineNames = [
    ...new Set(flags.baseline.length > 0 ? flags.baseline : DEFAULT_BASELINES),
  ];

  const registers = await registerPaths(dataDir);
  const baselinePaths = baselineNames.map((name) => {
    const found = registers.find((path) => path.endsWith(`/${name}`));
    if (found === undefined) {
      throw new Error(`No register ${name} under ${voiceBaselineDir(dataDir)}`);
    }
    return found;
  });

  const named = flags.kind.map((kind) => {
    if (!isDocumentKind(kind)) {
      throw new Error(`Unknown kind ${kind}. One of ${DOCUMENT_KINDS.join(", ")}.`);
    }
    return kind;
  });
  const selected = new Set(named.length > 0 ? named : DOCUMENT_KINDS);
  const kinds = [...selected];
  const filter = flags.studyFilter === undefined ? null : new RegExp(flags.studyFilter);

  const [studyAll, perRegister] = await Promise.all([
    readCorpus(studyPath),
    Promise.all(baselinePaths.map(readCorpus)),
  ]);

  return {
    study: {
      path: studyPath,
      kinds,
      documents: studyAll.filter(
        (doc) => selected.has(documentKind(doc.source)) && (filter?.test(doc.source) ?? true),
      ),
    },
    baseline: { names: baselineNames, paths: baselinePaths, documents: perRegister.flat() },
    registers,
  };
}

// Both counts are of what survived selection.
export interface CorpusHeader {
  study: { path: string; kinds: DocumentKind[]; docs: number; tokens: number };
  baseline: { names: string[]; docs: number; tokens: number };
}

// Tokens come from the caller because each script counts them at a different
// stage: Delta after binning, overlap after tokenizing.
export function corpusHeader(
  { study, baseline }: CorpusSelection,
  tokens: { study: number; baseline: number },
): CorpusHeader {
  return {
    study: {
      path: study.path,
      kinds: study.kinds,
      docs: study.documents.length,
      tokens: tokens.study,
    },
    baseline: { names: baseline.names, docs: baseline.documents.length, tokens: tokens.baseline },
  };
}

export function corpusHeaderLines({ study, baseline }: CorpusHeader): string[] {
  return [
    `corpus A  ${study.docs} docs, ${study.tokens.toLocaleString()} tokens  kinds ${study.kinds.join(",")}  ${study.path}`,
    `corpus B  ${baseline.docs} docs, ${baseline.tokens.toLocaleString()} tokens  ${baseline.names.join(", ")}`,
  ];
}
