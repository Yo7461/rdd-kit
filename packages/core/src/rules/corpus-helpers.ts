import type { IdDefinition } from '../corpus/index.js';
import type { CodeFenceInfo, HeadingInfo } from '../parse/markdown.js';
import type { ParsedFile } from '../parse/parsed-file.js';
import { lineRange } from './helpers.js';
import type { RuleDiagnostic } from './types.js';

export function fileMap(files: ParsedFile[]): Map<string, ParsedFile> {
  return new Map(files.map((f) => [f.relPath, f]));
}

/** A line anchor (the Range of the whole line). Degrades to a file anchor when the file cannot be found. */
export function lineAnchor(
  files: Map<string, ParsedFile>,
  relPath: string,
  line: number,
): RuleDiagnostic['anchor'] {
  const file = files.get(relPath);
  if (!file) return { kind: 'file', file: relPath };
  return { kind: 'range', file: relPath, range: lineRange(file, line) };
}

/** The anchor of a definition (the whole file for via: path, the definition line otherwise). */
export function definitionAnchor(
  files: Map<string, ParsedFile>,
  definition: IdDefinition,
): RuleDiagnostic['anchor'] {
  return definition.via === 'path'
    ? { kind: 'file', file: definition.file }
    : lineAnchor(files, definition.file, definition.line);
}

/** How a definition site is shown (in a message). */
export function describeDefinitionPlace(definition: IdDefinition): string {
  return definition.via === 'path'
    ? definition.file
    : `${definition.file}:${definition.line + 1}`;
}

export interface ContractFence {
  heading: HeadingInfo;
  fence: CodeFenceInfo;
}

/**
 * The contract YAML block of a spec domain file (a yaml fence that starts directly below a C#### heading, on the next line).
 * Telling it apart from an example fence makes it something REF-1 walks and something REF-2 checks source / verified_by in.
 */
export function contractYamlFences(file: ParsedFile): ContractFence[] {
  if (file.type !== 'spec-domain' || !file.markdown) return [];
  const out: ContractFence[] = [];
  for (const fence of file.markdown.codeFences) {
    if (fence.lang !== 'yaml') continue;
    const heading = file.markdown.headings.find(
      (h) => h.depth === 2 && h.range.start.line + 1 === fence.range.start.line,
    );
    if (heading && /^C\d{4}:/.test(heading.text)) {
      out.push({ heading, fence });
    }
  }
  return out;
}
