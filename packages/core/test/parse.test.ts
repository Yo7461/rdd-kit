import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../src/parse/markdown.js';
import { normalizeText, splitLines } from '../src/parse/source.js';

// The sample document stays in Japanese on purpose: the records this linter reads are written in the
// user's language, so the character offsets of a Range have to be right for multi-byte text as well.
const SAMPLE_LINES = [
  '---', // 0
  'title: サンプル', // 1
  'count: 3', // 2
  '---', // 3
  '', // 4
  '# 見出し1', // 5
  '', // 6
  '本文。', // 7
  '', // 8
  '```yaml', // 9
  'key: value', // 10
  '```', // 11
  '', // 12
  '## 見出し2', // 13
  '', // 14
  '- リスト', // 15
  '',
];
const SAMPLE = SAMPLE_LINES.join('\n');

describe('normalizeText / splitLines (the definition of the line count)', () => {
  it('normalizes CRLF and CR to LF', () => {
    expect(normalizeText('a\r\nb\rc\n')).toBe('a\nb\nc\n');
  });

  it('strips a leading BOM', () => {
    expect(normalizeText(String.fromCharCode(0xfeff) + 'a\n')).toBe('a\n');
  });

  it('does not count a trailing newline as a line', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\nb')).toEqual(['a', 'b']);
  });

  it('counts a trailing blank line (two newlines) as one line', () => {
    expect(splitLines('a\n\n')).toEqual(['a', '']);
  });

  it('counts an empty file as 0 lines and a lone newline as 1', () => {
    expect(splitLines('')).toEqual([]);
    expect(splitLines('\n')).toEqual(['']);
  });
});

describe('parsing with positions', () => {
  const index = parseMarkdown(SAMPLE);

  it('reads the front matter with its value and position', () => {
    expect(index.frontMatter).not.toBeNull();
    expect(index.frontMatter?.data).toEqual({ title: 'サンプル', count: 3 });
    expect(index.frontMatter?.parseError).toBeNull();
    expect(index.frontMatter?.raw).toBe('title: サンプル\ncount: 3');
    // From the opening --- through the closing --- (0-based, end exclusive)
    expect(index.frontMatter?.range).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 3, character: 3 },
    });
  });

  it('reads a heading with its depth, text, and position', () => {
    expect(index.headings).toEqual([
      {
        depth: 1,
        text: '見出し1',
        range: { start: { line: 5, character: 0 }, end: { line: 5, character: 6 } },
      },
      {
        depth: 2,
        text: '見出し2',
        range: { start: { line: 13, character: 0 }, end: { line: 13, character: 7 } },
      },
    ]);
  });

  it('reads a code fence with its language and position', () => {
    expect(index.codeFences).toEqual([
      {
        lang: 'yaml',
        range: { start: { line: 9, character: 0 }, end: { line: 11, character: 3 } },
      },
    ]);
  });

  it('builds the same index from CRLF input once it is normalized', () => {
    const crlf = parseMarkdown(normalizeText(SAMPLE_LINES.join('\r\n')));
    expect(crlf).toEqual(index);
  });

  it('identifies a code fence inside a list', () => {
    const nested = parseMarkdown(['- item', '', '  ```', '  code', '  ```', ''].join('\n'));
    expect(nested.codeFences).toHaveLength(1);
    expect(nested.codeFences[0]?.lang).toBeNull();
  });

  it('returns null when there is no front matter', () => {
    expect(parseMarkdown('# 見出し\n').frontMatter).toBeNull();
  });

  it('does not treat unclosed front matter as front matter', () => {
    const broken = parseMarkdown(['---', 'title: x', '', '# h', ''].join('\n'));
    expect(broken.frontMatter).toBeNull();
  });

  it('lands a YAML syntax error in parseError (it never throws)', () => {
    const invalid = parseMarkdown(['---', 'a: [', '---', ''].join('\n'));
    expect(invalid.frontMatter?.parseError).not.toBeNull();
    expect(invalid.frontMatter?.data).toBeNull();
  });
});
