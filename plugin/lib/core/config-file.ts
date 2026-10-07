import type { LintConfig, RuleConfig } from './config.ts';
import type { Host } from './host.ts';
import path from './path.ts';

/** The name of the config file found automatically (it sits next to roadmap/). */
export const CONFIG_FILE_NAME = '.roadmap-lint.json';

/** An error that comes from the config (the CLI turns it into exit 2). */
export class ConfigError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns the path of the config file in baseDir (the parent of roadmap/) when there is one. */
export async function discoverConfigFile(baseDir: string, host: Host): Promise<string | null> {
  const candidate = path.join(baseDir, CONFIG_FILE_NAME);
  return (await host.exists(candidate)) ? candidate : null;
}

/**
 * Loads and validates the config file.
 * An unknown rule ID is allowed (forward compatibility — the config of a rule that is not implemented yet can be written ahead of it).
 * An unknown key or a wrong type is a ConfigError (catching a typo comes first).
 */
export async function loadConfigFile(filePath: string, host: Host): Promise<LintConfig> {
  let raw: string;
  try {
    raw = await host.readText(filePath);
  } catch {
    throw new ConfigError(`Cannot read the config file: ${filePath}.`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new ConfigError(
      `Cannot parse the config file as JSON: ${filePath} (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  return validateConfig(data, filePath);
}

function validateConfig(data: unknown, source: string): LintConfig {
  if (!isRecord(data)) {
    throw new ConfigError(`The config must be an object: ${source}.`);
  }
  const unknownKeys = Object.keys(data).filter((k) => k !== 'rules');
  if (unknownKeys.length > 0) {
    throw new ConfigError(
      `The config has unknown keys: ${unknownKeys.join(', ')} (allowed: rules) — ${source}.`,
    );
  }
  if (!('rules' in data)) return {};
  const rules = data['rules'];
  if (!isRecord(rules)) {
    throw new ConfigError(`rules must be an object: ${source}.`);
  }
  const out: Record<string, RuleConfig> = {};
  for (const [ruleId, ruleConfig] of Object.entries(rules)) {
    if (!isRecord(ruleConfig)) {
      throw new ConfigError(`rules.${ruleId} must be an object: ${source}.`);
    }
    const unknown = Object.keys(ruleConfig).filter(
      (k) => k !== 'enabled' && k !== 'severity' && k !== 'options',
    );
    if (unknown.length > 0) {
      throw new ConfigError(
        `rules.${ruleId} has unknown keys: ${unknown.join(', ')} (allowed: enabled | severity | options) — ${source}.`,
      );
    }
    const entry: RuleConfig = {};
    if ('enabled' in ruleConfig) {
      if (typeof ruleConfig['enabled'] !== 'boolean') {
        throw new ConfigError(`rules.${ruleId}.enabled must be true or false: ${source}.`);
      }
      entry.enabled = ruleConfig['enabled'];
    }
    if ('severity' in ruleConfig) {
      const severity = ruleConfig['severity'];
      if (severity !== 'error' && severity !== 'warning') {
        throw new ConfigError(
          `rules.${ruleId}.severity must be either error or warning: ${source}.`,
        );
      }
      entry.severity = severity;
    }
    if ('options' in ruleConfig) {
      if (!isRecord(ruleConfig['options'])) {
        throw new ConfigError(`rules.${ruleId}.options must be an object: ${source}.`);
      }
      entry.options = ruleConfig['options'];
    }
    out[ruleId] = entry;
  }
  return { rules: out };
}
