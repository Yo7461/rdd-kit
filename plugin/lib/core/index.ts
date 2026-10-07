export { severityRank } from './diagnostic.ts';
export type { Anchor, Diagnostic, Position, Range, Severity } from './diagnostic.ts';
export { resolveRuleConfig } from './config.ts';
export type { LintConfig, ResolvedRuleConfig, RuleConfig, RuleDefaults } from './config.ts';
export { CONFIG_FILE_NAME, ConfigError, discoverConfigFile, loadConfigFile } from './config-file.ts';
export { normalizeText, splitLines } from './parse/source.ts';
export { parseFrontMatterValue } from './parse/frontmatter.ts';
export type { FrontMatterValue } from './parse/frontmatter.ts';
export { parseMarkdown } from './parse/markdown.ts';
export type {
  BlockquoteInfo,
  CodeFenceInfo,
  FrontMatterInfo,
  HeadingInfo,
  InlineCodeInfo,
  LinkInfo,
  ListItemInfo,
  MarkdownIndex,
} from './parse/markdown.ts';
export { parseRoadmapFile, parseSource } from './parse/parsed-file.ts';
export type { ParsedFile } from './parse/parsed-file.ts';
export {
  findH2Section,
  h2Sections,
  lineInBlockquote,
  lineInCode,
  positionInInlineCode,
  positionInRange,
} from './parse/sections.ts';
export type { H2Section } from './parse/sections.ts';
export { buildCorpusIndex, isDefined, layerOf } from './corpus/index.ts';
export { collectGitInfo, isUncommittedHash, parseBlamePorcelain, UNCOMMITTED_HASH } from './corpus/git.ts';
export type { GitCommitInfo, GitInfo, LineHistory } from './corpus/git.ts';
export type {
  CorpusEntry,
  CorpusIndex,
  DefinitionVia,
  IdDefinition,
  IdKind,
  Layer,
} from './corpus/index.ts';
export { classifyFile, collectFiles, resolveTarget, toPosix } from './files.ts';
export type { FileType, RoadmapFileRef, RoadmapTarget } from './files.ts';
export type { Host, HostEntry, HostKind, HostRunResult, HostStat } from './host.ts';
export {
  CONTRACT_STABILITIES,
  FILE_TYPE_SCHEMAS,
  PHASE_STATES,
  PHASE_TYPES,
  describeSpec,
  idPattern,
  validateValue,
} from './schema/file-types.ts';
export type { FileTypeSchema, FrontMatterKeySpec, KnownFileType, ValueSpec } from './schema/file-types.ts';
export type { CorpusRuleContext, RuleContext, RuleDiagnostic, RuleModule } from './rules/types.ts';
export { allRules } from './rules/registry.ts';
export { lintPath, runLint } from './engine.ts';
export type { LintOptions, LintResult } from './engine.ts';
export { compareDiagnostics, sortDiagnostics } from './report/sort.ts';
export { formatText } from './report/text.ts';
export { plural } from './plural.ts';
export { formatJson, toJsonReport, JSON_FORMAT_VERSION } from './report/json.ts';
export type { JsonReport } from './report/json.ts';
