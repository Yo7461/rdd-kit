import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Nodes } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toString } from 'mdast-util-to-string';
import { describe, expect, it } from 'vitest';
import { allRules } from '../src/rules/registry.js';

/**
 * The READMEs and doc/ restate facts that live elsewhere: the number of rules, each rule's ID,
 * default severity, description and options, the defaults the skill writes to, the license the
 * manifests name, and the owner and names the install commands carry. A restated fact drifts when
 * its source changes — a rule count left behind after a rule is added is the drift they guard
 * against first — so these tests hold the documentation against the registry, the manifests, and
 * the files it links to.
 *
 * Two conventions keep the checks exact. A count of only some of the rules is written in words, so
 * `<number> rules` always means all of them. And the documentation links with Markdown links only —
 * a raw HTML link is refused, because nothing here would follow it.
 */

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

function read(rel: string): string {
  // A checkout with autocrlf on reads the text back with CRLF
  return readFileSync(path.join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n');
}

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(read(rel)) as Record<string, unknown>;
}

/** Every Markdown file under a directory, at any depth — POSIX paths from the repository root. */
function markdownFilesUnder(relDir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(repoRoot, relDir), { withFileTypes: true })) {
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...markdownFilesUnder(rel));
    else if (entry.name.endsWith('.md')) out.push(rel);
  }
  return out.sort();
}

/** README.md, plugin/README.md, and every Markdown file under doc/. */
function documents(): string[] {
  return ['README.md', 'plugin/README.md', ...markdownFilesUnder('doc')];
}

/** The skill text ships with the plugin and restates the rule count as well. */
function skillFiles(): string[] {
  return markdownFilesUnder('plugin/skills');
}

function captures(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1] as string);
}

// ---------------------------------------------------------------------------------------------
// Tables

interface Table {
  header: string[];
  rows: string[][];
}

/** The cells of a table row: split on the pipes that are not escaped, then unescaped. */
function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/u, '')
    .replace(/\|$/u, '')
    .split(/(?<!\\)\|/u)
    .map((cell) => cell.trim().replace(/\\\|/gu, '|'));
}

/** Every table under a `## ` heading. A run of lines that starts with a pipe is one table. */
function tablesUnder(rel: string, heading: string): Table[] {
  const lines = read(rel).split('\n');
  const start = lines.indexOf(`## ${heading}`);
  if (start < 0) throw new Error(`The \`## ${heading}\` section is missing from ${rel}`);
  const tables: Table[] = [];
  let run: string[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    const [header, separator, ...rows] = run.map(cells);
    if (!header || !separator || !separator.every((cell) => /^:?-+:?$/u.test(cell))) {
      throw new Error(`A table under \`## ${heading}\` in ${rel} has no header and separator rows`);
    }
    tables.push({ header, rows });
    run = [];
  };
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    if (line.trimStart().startsWith('|')) run.push(line);
    else if (run.length > 0 && line.trim() !== '') {
      // A line that directly follows a table row renders as one more row, pipes or not
      throw new Error(`A line under \`## ${heading}\` in ${rel} would render as a table row: ${line}`);
    } else flush();
  }
  flush();
  return tables;
}

/** A default short enough to sit in the rule table itself; a longer one (a list) goes in the table below it. */
function isInline(value: unknown): boolean {
  return JSON.stringify(value).length <= 12;
}

function optionOf(ruleId: string, key: string): unknown {
  const rule = allRules.find((candidate) => candidate.id === ruleId);
  if (!rule || !(key in rule.defaultOptions)) throw new Error(`${ruleId} has no option ${key}`);
  return rule.defaultOptions[key];
}

describe('the rule tables in doc/roadmap-lint.md', () => {
  // Read inside each test, so a table that cannot be read fails the tests that need it and no others
  const tables = (): Table[] => tablesUnder('doc/roadmap-lint.md', 'Rules');

  it('are two: the rules, and the defaults that are lists', () => {
    expect(tables().map((table) => table.header)).toEqual([
      ['Rule', 'Default severity', 'What it checks', 'Options (default)'],
      ['Option', 'Default'],
    ]);
  });

  it('list every rule of the registry with its default severity, description, and options — and nothing else', () => {
    const expected = allRules.map((rule) => {
      const entries = Object.entries(rule.defaultOptions);
      const options =
        entries.length === 0
          ? '—'
          : entries
              .map(([key, value]) =>
                isInline(value) ? `\`${key}\` (\`${JSON.stringify(value)}\`)` : `\`${key}\``,
              )
              .join(', ');
      return [`\`${rule.id}\``, rule.defaultSeverity, rule.description, options];
    });
    // A row of any other shape fails here too: toEqual compares every row the table has
    expect(tables()[0]?.rows).toEqual(expected);
  });

  it('spell out every default that is a list', () => {
    const expected: string[][] = [];
    for (const rule of allRules) {
      for (const [key, value] of Object.entries(rule.defaultOptions)) {
        if (isInline(value)) continue;
        expect(Array.isArray(value), `${rule.id} ${key}`).toBe(true);
        const items = (value as unknown[]).map((item) => `\`${String(item)}\``).join(', ');
        expected.push([`\`${rule.id}\` \`${key}\``, items]);
      }
    }
    expect(expected.length).toBeGreaterThan(0);
    expect(tables()[1]?.rows).toEqual(expected);
  });
});

describe('the defaults doc/concepts.md restates', () => {
  it('match the rules the limits belong to', () => {
    const [table, ...others] = tablesUnder('doc/concepts.md', 'Defaults and the project\'s configuration');
    expect(others).toEqual([]);
    expect(table?.header).toEqual(['What', 'Default']);
    expect(table?.rows).toEqual([
      ['`status.md`', `${String(optionOf('SIZE-1', 'maxLines'))} lines, not counting the \`Phase Index\` section`],
      ['`spec/map.md`', `${String(optionOf('SIZE-2', 'maxLines'))} lines`],
      ['A contract file', `${String(optionOf('SIZE-3', 'maxLines'))} lines`],
      ['`roadmap.md`', `${String(optionOf('SIZE-7', 'maxLines'))} lines`],
      ['`Outcome Summary` of a phase', `${String(optionOf('SIZE-4', 'maxLines'))} lines`],
      ['`Session Log`', 'One line per session (fixed — no option changes it)'],
      ['Shelf life of a `Parking Lot` or `Deferred` item', `${String(optionOf('GIT-7', 'maxAgeDays'))} days`],
    ]);
    // The one row that names no number: the rule behind it takes no option
    expect(allRules.find((rule) => rule.id === 'SIZE-5')?.defaultOptions).toEqual({});
  });

  it('state the shelf life the same way in the prose', () => {
    const days = captures(read('doc/concepts.md'), /\b(\d+) days\b/gu);
    expect(days.length).toBeGreaterThanOrEqual(2);
    expect(new Set(days)).toEqual(new Set([String(optionOf('GIT-7', 'maxAgeDays'))]));
  });
});

describe('the rule count', () => {
  // How many times each file states the count. A reworded sentence changes the number and fails
  // here until it is pinned again — which is the moment to check that the new wording is still seen.
  const MENTIONS: Record<string, number> = {
    'README.md': 2,
    'plugin/README.md': 1,
    'doc/development.md': 1,
    'doc/roadmap-lint.md': 1,
    'plugin/skills/roadmap/SKILL.md': 1,
    'plugin/skills/roadmap/references/workflows.md': 1,
  };

  // `35 rules`, `35 lint rules`, `35-rule`, and a count wrapped onto the next line
  const COUNT = /(?<![\w.-])(\d+)(?:[\s-]+[a-z]+)?[\s-]+rules?\b/giu;

  for (const file of [...documents(), ...skillFiles()]) {
    it(`${file}: is the size of the registry wherever it is stated in digits`, () => {
      const counts = captures(read(file), COUNT);
      expect(counts).toEqual(Array.from({ length: MENTIONS[file] ?? 0 }, () => String(allRules.length)));
    });
  }

  it('is pinned only for files that exist', () => {
    const files = new Set([...documents(), ...skillFiles()]);
    expect(Object.keys(MENTIONS).filter((file) => !files.has(file))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Links

interface DocumentIndex {
  links: string[];
  anchors: Set<string>;
  html: string[];
}

function walk(node: Nodes, visit: (node: Nodes) => void): void {
  visit(node);
  if ('children' in node) {
    for (const child of node.children) walk(child, visit);
  }
}

/** The anchor GitHub generates for a heading: lower case, punctuation dropped, spaces to hyphens. */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/gu, '-');
}

function indexOf(rel: string): DocumentIndex {
  const links: string[] = [];
  const headings: string[] = [];
  const html: string[] = [];
  walk(fromMarkdown(read(rel)), (node) => {
    if (node.type === 'link' || node.type === 'image' || node.type === 'definition') links.push(node.url);
    else if (node.type === 'heading') headings.push(toString(node));
    else if (node.type === 'html') html.push(node.value);
  });
  // A heading that repeats gets a number: setup, setup-1, setup-2
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  for (const heading of headings) {
    const base = slug(heading);
    const count = seen.get(base) ?? 0;
    anchors.add(count === 0 ? base : `${base}-${count}`);
    seen.set(base, count + 1);
  }
  return { links, anchors, html };
}

/** Whether every segment of a path exists with exactly this spelling — Windows would accept another case. */
function existsExactly(rel: string): boolean {
  let dir = repoRoot;
  for (const segment of rel.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') return false;
    try {
      if (!readdirSync(dir).includes(segment)) return false;
    } catch {
      return false; // The segment before this one is a file
    }
    dir = path.join(dir, segment);
  }
  return true;
}

/** True when git ignores the path. No git, or no repository, means it cannot tell — and says no. */
function isIgnored(rel: string): boolean {
  return spawnSync('git', ['check-ignore', '-q', '--', rel], { cwd: repoRoot }).status === 0;
}

/** Paths the repository does not publish, though a working copy may hold them: a project's own records, its instructions for Claude Code, its local Claude Code setup. */
function isDevelopmentOnly(rel: string): boolean {
  return rel === 'CLAUDE.md' || rel.startsWith('roadmap/') || rel.startsWith('.claude/');
}

function decoded(link: string): string {
  try {
    return decodeURI(link);
  } catch {
    return link; // A stray % — the path is then looked up as it is written, and reported by name
  }
}

describe('the links in the documentation', () => {
  for (const document of documents()) {
    // Every page links somewhere in the repository — at the least back to the page that led to it
    it(`${document}: every relative link leads to a file, and every anchor to a heading`, () => {
      const { links, html } = indexOf(document);
      expect(html.filter((value) => /\b(?:href|src)\s*=/iu.test(value))).toEqual([]);

      const relative = links.filter((link) => !/^[a-z][a-z0-9+.-]*:/iu.test(link)); // not https:, mailto:, …
      expect(relative.length, `${document} links to nothing in the repository`).toBeGreaterThan(0);

      for (const link of relative) {
        const hint = `${document} links to ${link}`;
        expect(link, hint).not.toContain('\\');
        const [target = '', anchor] = decoded(link).split('#');
        const rel =
          target === ''
            ? document
            : target.startsWith('/')
              ? path.posix.normalize(target.slice(1)) // GitHub resolves a leading slash from the repository root
              : path.posix.normalize(path.posix.join(path.posix.dirname(document), target));
        expect(existsExactly(rel), hint).toBe(true);
        expect(isIgnored(rel), `${hint}, which git ignores`).toBe(false);
        expect(isDevelopmentOnly(rel), `${hint}, which the repository does not publish`).toBe(false);
        if (anchor !== undefined && rel.endsWith('.md')) {
          expect(indexOf(rel).anchors.has(anchor), hint).toBe(true);
        }
      }
    });

    it(`${document}: no table cell leaves a code span open`, () => {
      // The parser here reads a table row as one paragraph, so a code span left open in one cell
      // would swallow the links of the cells after it
      const open = read(document)
        .split('\n')
        .filter((line) => line.trimStart().startsWith('|'))
        .filter((line) => cells(line).some((cell) => (cell.match(/`/gu) ?? []).length % 2 === 1));
      expect(open).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// License and manifests

describe('the license', () => {
  // The SHA-256 of https://www.apache.org/licenses/LICENSE-2.0.txt (LF line endings)
  const APACHE_2_0_SHA256 = 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30';

  it('is the Apache-2.0 text, unmodified', () => {
    expect(createHash('sha256').update(read('LICENSE'), 'utf8').digest('hex')).toBe(APACHE_2_0_SHA256);
  });

  it('travels with the plugin unchanged, and both READMEs point at the third-party notices', () => {
    expect(read('plugin/LICENSE')).toBe(read('LICENSE'));
    for (const document of ['README.md', 'plugin/README.md']) {
      expect(read(document)).toContain('THIRD-PARTY-LICENSES.txt');
    }
  });

  it('is named the same in the manifest, in both packages, and in both READMEs', () => {
    expect(readJson('plugin/.claude-plugin/plugin.json')['license']).toBe('Apache-2.0');
    expect(readJson('packages/cli/package.json')['license']).toBe('Apache-2.0');
    expect(readJson('packages/core/package.json')['license']).toBe('Apache-2.0');
    expect(read('README.md')).toContain('Apache-2.0');
    expect(read('plugin/README.md')).toContain('Apache-2.0');
  });

  it('comes with one NOTICE file that names the copyright holder, and the plugin and the CLI package carry a copy', () => {
    const notices = ['.', 'plugin'].flatMap((dir) =>
      readdirSync(path.join(repoRoot, dir))
        .filter((name) => /^notice(\..+)?$/iu.test(name))
        .map((name) => `${dir}/${name}`),
    );
    expect(notices).toEqual(['./NOTICE', 'plugin/NOTICE']);
    // The holder is the owner the manifests name — one name everywhere
    const owner = (readJson('plugin/.claude-plugin/plugin.json')['author'] as Record<string, unknown>)['name'] as string;
    expect(read('NOTICE')).toBe(`rdd-kit\nCopyright 2026 ${owner}\n`);
    expect(read('plugin/NOTICE')).toBe(read('NOTICE'));
    expect(read('packages/cli/NOTICE')).toBe(read('NOTICE'));
    for (const document of ['README.md', 'plugin/README.md']) {
      expect(read(document)).toContain('[NOTICE](NOTICE)');
    }
  });
});

describe('the manifests', () => {
  const plugin = readJson('plugin/.claude-plugin/plugin.json');
  const marketplace = readJson('.claude-plugin/marketplace.json');
  const entry = (marketplace['plugins'] as Record<string, unknown>[])[0] as Record<string, unknown>;
  const owner = (plugin['author'] as Record<string, unknown>)['name'] as string;
  const pluginName = plugin['name'] as string;
  const marketplaceName = marketplace['name'] as string;

  it('carry the metadata a published plugin needs', () => {
    expect(() => new URL(plugin['homepage'] as string)).not.toThrow();
    expect(typeof plugin['repository']).toBe('string');
    const keywords = plugin['keywords'] as unknown[];
    expect(keywords.length).toBeGreaterThan(0);
    expect(keywords.every((keyword) => typeof keyword === 'string' && keyword !== '')).toBe(true);
    expect(typeof marketplace['description']).toBe('string');
    expect(marketplace['description']).not.toMatch(/\blocal\b/iu);
    expect(entry['name']).toBe(pluginName);
  });

  it('name one owner, and the documentation names the same one wherever a repository is named', () => {
    const repository = `${owner}/${pluginName}`;
    expect((marketplace['owner'] as Record<string, unknown>)['name']).toBe(owner);
    expect(plugin['homepage']).toBe(`https://github.com/${repository}`);
    expect(plugin['repository']).toBe(`https://github.com/${repository}`);

    // `<owner>/<repository>` on its own (the GitHub shorthand of the install commands), and the
    // same pair inside a github.com address, https or ssh. A path such as cache/<name>/<name>/ is
    // neither: the token before it ends with a slash
    const shorthand = new RegExp(`(?<![\\w/.:@-])([\\w-]+)/${pluginName}(?![\\w-])`, 'gu');
    const address = /(?<![\w.])github\.com[/:]([\w-]+\/[\w.-]+)/gu;
    const found: string[] = [];
    for (const document of documents()) {
      const text = read(document);
      for (const value of captures(text, shorthand)) {
        found.push(`${document}: shorthand`);
        expect(`${document}: ${value}/${pluginName}`).toBe(`${document}: ${repository}`);
      }
      for (const value of captures(text, address)) {
        found.push(`${document}: address`);
        const named = value.replace(/\.git$/u, '').replace(/\.+$/u, '');
        expect(`${document}: ${named}`).toBe(`${document}: ${repository}`);
      }
    }
    // Two commands in the README and one in the plugin's. A different list means a command was
    // added or reworded — the moment to check that the new form is still seen
    expect(found.sort()).toEqual(['README.md: shorthand', 'README.md: shorthand', 'plugin/README.md: shorthand']);
  });

  it('give the plugin and marketplace names the documentation uses', () => {
    const id = `${pluginName}@${marketplaceName}`;
    const found: string[] = [];
    for (const document of documents()) {
      const text = read(document);
      // Every `<plugin>@<marketplace>`, whichever command carries it
      for (const match of text.matchAll(/(?<![\w.-])([a-z][\w-]*@[a-z][\w-]*)/giu)) {
        found.push(`${document}: id`);
        expect(`${document}: ${match[1] as string}`).toBe(`${document}: ${id}`);
      }
      for (const value of captures(text, /\/plugin install ([^\s`@]+) --marketplace/gu)) {
        found.push(`${document}: plugin`);
        expect(`${document}: ${value}`).toBe(`${document}: ${pluginName}`);
      }
      for (const value of captures(text, /marketplace (?:remove|update) ([^\s`]+)/gu)) {
        found.push(`${document}: marketplace`);
        expect(`${document}: ${value}`).toBe(`${document}: ${marketplaceName}`);
      }
      // The installed copy: cache/<marketplace>/, or cache/<marketplace>/<plugin>/<version>/
      // A name is words joined by dots, so a name with a dot in it is read whole, not up to the dot
      for (const match of text.matchAll(/plugins\/cache\/([\w-]+(?:\.[\w-]+)*)(?:\/([\w-]+(?:\.[\w-]+)*))?/gu)) {
        found.push(`${document}: cache`);
        const named = match[2] === undefined ? (match[1] as string) : `${match[1] as string}/${match[2]}`;
        const expected = match[2] === undefined ? marketplaceName : `${marketplaceName}/${pluginName}`;
        expect(`${document}: ${named}`).toBe(`${document}: ${expected}`);
      }
    }
    expect(found.sort()).toEqual([
      'README.md: cache',
      'README.md: id',
      'README.md: id',
      'README.md: id',
      'README.md: marketplace',
      'README.md: plugin',
      'plugin/README.md: id',
    ]);
  });

  it('describe the plugin in the same sentence as the READMEs', () => {
    expect(entry['description']).toBe(plugin['description']);
    for (const document of ['README.md', 'plugin/README.md']) {
      expect(read(document).split('\n')[2]).toBe(plugin['description']);
    }
  });

  // A release adds its line at the top of the upgrade notes; a version raised without one fails here
  it('carry the version that heads the upgrade notes', () => {
    const section = read('doc/roadmap-lint.md').split('\n## Upgrade notes\n')[1] ?? '';
    const first = section.split('\n').find((line) => line.startsWith('- '));
    const head = `- **${plugin['version'] as string}** — `;
    expect((first ?? '').slice(0, head.length)).toBe(head);
  });
});
