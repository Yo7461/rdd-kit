import { fromMarkdown } from 'mdast-util-from-markdown';
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter';
import { toString } from 'mdast-util-to-string';
import { frontmatter } from 'micromark-extension-frontmatter';
import type { Heading, Nodes } from 'mdast';
import type { Range } from '../diagnostic.js';
import { parseFrontMatterValue } from './frontmatter.js';

export interface FrontMatterInfo {
  /** The YAML body without the --- fences */
  raw: string;
  data: unknown;
  parseError: string | null;
  /** The range covering the opening --- through the closing --- */
  range: Range;
}

export interface HeadingInfo {
  depth: Heading['depth'];
  text: string;
  range: Range;
}

export interface CodeFenceInfo {
  /** null for an indented code block (treated as a region that is "not prose", like a fence) */
  lang: string | null;
  range: Range;
}

/** An inline code span (excluded as an example by REF-1, checked by REF-2 (c)). */
export interface InlineCodeInfo {
  /** The code string without the backticks */
  value: string;
  range: Range;
}

/** A blockquote (excluded as an example by REF-1). */
export interface BlockquoteInfo {
  range: Range;
}

/** The target of a link or an image (REF-2 (b)). */
export interface LinkInfo {
  url: string;
  range: Range;
}

/**
 * A list item with its nesting depth (1 = an item of a top-level list) and the range of everything it
 * holds — a nested list, a later paragraph, a lazy continuation (GIT-7 dates Parking Lot / Deferred items by it).
 */
export interface ListItemInfo {
  depth: number;
  range: Range;
}

export interface MarkdownIndex {
  frontMatter: FrontMatterInfo | null;
  headings: HeadingInfo[];
  codeFences: CodeFenceInfo[];
  inlineCode: InlineCodeInfo[];
  blockquotes: BlockquoteInfo[];
  links: LinkInfo[];
  listItems: ListItemInfo[];
}

type UnistPosition = NonNullable<Nodes['position']>;

/** unist (1-based, end at the next character) → an LSP-compatible Range (0-based, end exclusive). */
function toRange(position: UnistPosition): Range {
  return {
    start: { line: position.start.line - 1, character: position.start.column - 1 },
    end: { line: position.end.line - 1, character: position.end.column - 1 },
  };
}

function walk(node: Nodes, visit: (n: Nodes) => void): void {
  visit(node);
  if ('children' in node) {
    for (const child of node.children) walk(child, visit);
  }
}

/** Collects list items with their nesting depth (the plain walk above has no notion of depth). */
function collectListItems(node: Nodes, depth: number, out: ListItemInfo[]): void {
  if (node.type === 'list') {
    for (const item of node.children) {
      if (item.position) out.push({ depth, range: toRange(item.position) });
      for (const child of item.children) collectListItems(child, depth + 1, out);
    }
    return;
  }
  if ('children' in node) {
    for (const child of node.children) collectListItems(child, depth, out);
  }
}

/** Indexes headings, code fences, list items, and the YAML front matter with their positions. */
export function parseMarkdown(normalizedText: string): MarkdownIndex {
  const tree = fromMarkdown(normalizedText, {
    extensions: [frontmatter(['yaml'])],
    mdastExtensions: [frontmatterFromMarkdown(['yaml'])],
  });
  const index: MarkdownIndex = {
    frontMatter: null,
    headings: [],
    codeFences: [],
    inlineCode: [],
    blockquotes: [],
    links: [],
    listItems: [],
  };
  collectListItems(tree, 1, index.listItems);
  walk(tree, (node) => {
    if (!node.position) return;
    const range = toRange(node.position);
    if (node.type === 'yaml') {
      index.frontMatter = { raw: node.value, range, ...parseFrontMatterValue(node.value) };
    } else if (node.type === 'heading') {
      index.headings.push({ depth: node.depth, text: toString(node), range });
    } else if (node.type === 'code') {
      index.codeFences.push({ lang: node.lang ?? null, range });
    } else if (node.type === 'inlineCode') {
      index.inlineCode.push({ value: node.value, range });
    } else if (node.type === 'blockquote') {
      index.blockquotes.push({ range });
    } else if (node.type === 'link' || node.type === 'image') {
      index.links.push({ url: node.url, range });
    }
  });
  return index;
}
