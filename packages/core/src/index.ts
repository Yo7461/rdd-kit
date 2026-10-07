export { severityRank } from './diagnostic.js';
export type { Anchor, Diagnostic, Position, Range, Severity } from './diagnostic.js';
export { resolveRuleConfig } from './config.js';
export type { LintConfig, ResolvedRuleConfig, RuleConfig, RuleDefaults } from './config.js';
export { CONFIG_FILE_NAME, ConfigError, discoverConfigFile, loadConfigFile } from './config-file.js';
export { normalizeText, splitLines } from './parse/source.js';
export { parseFrontMatterValue } from './parse/frontmatter.js';
export type { FrontMatterValue } from './parse/frontmatter.js';
export { parseMarkdown } from './parse/markdown.js';
export type {
  BlockquoteInfo,
  CodeFenceInfo,
  FrontMatterInfo,
  HeadingInfo,
  InlineCodeInfo,
  LinkInfo,
  ListItemInfo,
  MarkdownIndex,
} from './parse/markdown.js';
export { parseRoadmapFile, parseSource } from './parse/parsed-file.js';
export type { ParsedFile } from './parse/parsed-file.js';
export {
  findH2Section,
  h2Sections,
  lineInBlockquote,
  lineInCode,
  positionInInlineCode,
  positionInRange,
} from './parse/sections.js';
export type { H2Section } from './parse/sections.js';
export { buildCorpusIndex, isDefined, layerOf } from './corpus/index.js';
export { collectGitInfo, isUncommittedHash, parseBlamePorcelain, UNCOMMITTED_HASH } from './corpus/git.js';
export type { GitCommitInfo, GitInfo, LineHistory } from './corpus/git.js';
export type {
  CorpusEntry,
  CorpusIndex,
  DefinitionVia,
  IdDefinition,
  IdKind,
  Layer,
} from './corpus/index.js';
export { classifyFile, collectFiles, resolveTarget, toPosix } from './files.js';
export type { FileType, RoadmapFileRef, RoadmapTarget } from './files.js';
export type { Host, HostEntry, HostKind, HostRunResult, HostStat } from './host.js';
export {
  CONTRACT_STABILITIES,
  FILE_TYPE_SCHEMAS,
  PHASE_STATES,
  PHASE_TYPES,
  describeSpec,
  idPattern,
  validateValue,
} from './schema/file-types.js';
export type { FileTypeSchema, FrontMatterKeySpec, KnownFileType, ValueSpec } from './schema/file-types.js';
export type { CorpusRuleContext, RuleContext, RuleDiagnostic, RuleModule } from './rules/types.js';
export { allRules } from './rules/registry.js';
export { lintPath, runLint } from './engine.js';
export type { LintOptions, LintResult } from './engine.js';
export { compareDiagnostics, sortDiagnostics } from './report/sort.js';
export { formatText } from './report/text.js';
export { plural } from './plural.js';
export { formatJson, toJsonReport, JSON_FORMAT_VERSION } from './report/json.js';
export type { JsonReport } from './report/json.js';
