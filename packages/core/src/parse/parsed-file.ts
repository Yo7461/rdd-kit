import { readFileSync } from 'node:fs';
import { classifyFile, type FileType, type RoadmapFileRef } from '../files.js';
import { parseMarkdown, type MarkdownIndex } from './markdown.js';
import { normalizeText, splitLines } from './source.js';

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

export function parseRoadmapFile(ref: RoadmapFileRef): ParsedFile {
  return parseSource(ref.relPath, readFileSync(ref.absPath, 'utf8'));
}
