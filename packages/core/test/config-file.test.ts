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
import { nodeHost } from '../src/testing/index.js';

const dir = mkdtempSync(path.join(tmpdir(), 'roadmap-lint-config-'));
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));

let counter = 0;
function write(content: string): string {
  const filePath = path.join(dir, `case-${counter++}.json`);
  writeFileSync(filePath, content);
  return filePath;
}

describe('loadConfigFile', () => {
  it('reads enabled, severity, and options', async () => {
    const filePath = write(
      JSON.stringify({
        rules: { 'SIZE-1': { enabled: false, severity: 'warning', options: { maxLines: 100 } } },
      }),
    );
    expect(await loadConfigFile(filePath, nodeHost)).toEqual({
      rules: { 'SIZE-1': { enabled: false, severity: 'warning', options: { maxLines: 100 } } },
    });
  });

  it('treats an empty object and an omitted rules key as the defaults', async () => {
    expect(await loadConfigFile(write('{}'), nodeHost)).toEqual({});
  });

  it('allows an unknown rule ID (forward compatibility)', async () => {
    const filePath = write(JSON.stringify({ rules: { 'FUTURE-9': { enabled: false } } }));
    expect(await loadConfigFile(filePath, nodeHost)).toEqual({ rules: { 'FUTURE-9': { enabled: false } } });
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
  ])('%s is a ConfigError', async (_label, content) => {
    await expect(loadConfigFile(write(content), nodeHost)).rejects.toThrow(ConfigError);
  });

  it('makes an unreadable path a ConfigError', async () => {
    await expect(loadConfigFile(path.join(dir, 'missing.json'), nodeHost)).rejects.toThrow(ConfigError);
  });
});

describe('discoverConfigFile', () => {
  it('finds the config directly under baseDir (null when there is none)', async () => {
    const baseDir = mkdtempSync(path.join(tmpdir(), 'roadmap-lint-discover-'));
    try {
      expect(await discoverConfigFile(baseDir, nodeHost)).toBeNull();
      writeFileSync(path.join(baseDir, CONFIG_FILE_NAME), '{}');
      // The core's own path functions answer with forward slashes, whatever the platform's separator
      expect(await discoverConfigFile(baseDir, nodeHost)).toBe(path.join(baseDir, CONFIG_FILE_NAME).replace(/\\/g, '/'));
    } finally {
      rmSync(baseDir, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
