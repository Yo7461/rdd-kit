import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CONFIG_FILE_NAME,
  ConfigError,
  discoverConfigFile,
  loadConfigFile,
} from '../src/config-file.js';

const dir = mkdtempSync(path.join(tmpdir(), 'roadmap-lint-config-'));
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));

let counter = 0;
function write(content: string): string {
  const filePath = path.join(dir, `case-${counter++}.json`);
  writeFileSync(filePath, content);
  return filePath;
}

describe('loadConfigFile', () => {
  it('reads enabled, severity, and options', () => {
    const filePath = write(
      JSON.stringify({
        rules: { 'SIZE-1': { enabled: false, severity: 'warning', options: { maxLines: 100 } } },
      }),
    );
    expect(loadConfigFile(filePath)).toEqual({
      rules: { 'SIZE-1': { enabled: false, severity: 'warning', options: { maxLines: 100 } } },
    });
  });

  it('treats an empty object and an omitted rules key as the defaults', () => {
    expect(loadConfigFile(write('{}'))).toEqual({});
  });

  it('allows an unknown rule ID (forward compatibility)', () => {
    const filePath = write(JSON.stringify({ rules: { 'FUTURE-9': { enabled: false } } }));
    expect(loadConfigFile(filePath)).toEqual({ rules: { 'FUTURE-9': { enabled: false } } });
  });

  it.each([
    ['broken JSON', '{'],
    ['an array', '[]'],
    ['an unknown top-level key (catching a typo)', '{"rule": {}}'],
    ['rules as an array', '{"rules": []}'],
    ['a rule config that is not an object', '{"rules": {"SIZE-1": true}}'],
    ['an unknown key in a rule config', '{"rules": {"SIZE-1": {"enable": true}}}'],
    ['a wrong type for enabled', '{"rules": {"SIZE-1": {"enabled": "yes"}}}'],
    ['an invalid value for severity', '{"rules": {"SIZE-1": {"severity": "info"}}}'],
    ['a wrong type for options', '{"rules": {"SIZE-1": {"options": 60}}}'],
  ])('%s is a ConfigError', (_label, content) => {
    expect(() => loadConfigFile(write(content))).toThrow(ConfigError);
  });

  it('makes an unreadable path a ConfigError', () => {
    expect(() => loadConfigFile(path.join(dir, 'missing.json'))).toThrow(ConfigError);
  });
});

describe('discoverConfigFile', () => {
  it('finds the config directly under baseDir (null when there is none)', () => {
    const baseDir = mkdtempSync(path.join(tmpdir(), 'roadmap-lint-discover-'));
    try {
      expect(discoverConfigFile(baseDir)).toBeNull();
      writeFileSync(path.join(baseDir, CONFIG_FILE_NAME), '{}');
      expect(discoverConfigFile(baseDir)).toBe(path.join(baseDir, CONFIG_FILE_NAME));
    } finally {
      rmSync(baseDir, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
