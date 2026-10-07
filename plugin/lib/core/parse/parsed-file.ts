import { classifyFile, type FileType, type RoadmapFileRef } from '../files.ts';
import type { Host } from '../host.ts';
import { parseMarkdown, type MarkdownIndex } from './markdown.ts';
import { normalizeText, splitLines } from './source.ts';

export interface ParsedFile {
  relPath: string;
  type: FileType;
  /** The normalized text (BOM stripped, line endings unified to \n) */
  text: string;
  lines: string[];
  /** The physical line count (the front matter and blank lines included, a trailing newline not counted) */
  lineCount: number;
  /** .md only. null for anything else */
  markdown: MarkdownIndex | null;
}

/** Builds a ParsedFile from text (for tests and synthetic input. The type is classified from relPath). */
export function parseSource(relPath: string, rawText: string): ParsedFile {
  const text = normalizeText(rawText);
  const lines = splitLines(text);
  return {
    relPath,
    type: classifyFile(relPath),
    text,
    lines,
    lineCount: lines.length,
    markdown: relPath.endsWith('.md') ? parseMarkdown(text) : null,
  };
}

export async function parseRoadmapFile(ref: RoadmapFileRef, host: Host): Promise<ParsedFile> {
  return parseSource(ref.relPath, await host.readText(ref.absPath));
}
