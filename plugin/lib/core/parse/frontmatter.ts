import { parse as parseYamlSource } from '../../vendor/yaml/browser/index.js';

export interface FrontMatterValue {
  data: unknown;
  parseError: string | null;
}

/**
 * Turns the YAML body of the front matter (the part without the --- fences) into a value. Never throws, even on failure.
 * The parser is told to keep its warnings to itself (an unresolved tag, say): it would print them with `console`,
 * which the plugin's hooks-module environment does not have — an error still throws, as it must.
 */
export function parseFrontMatterValue(raw: string): FrontMatterValue {
  try {
    return { data: parseYamlSource(raw, { logLevel: 'error' }) ?? null, parseError: null };
  } catch (error) {
    return { data: null, parseError: error instanceof Error ? error.message : String(error) };
  }
}
