import { parse as parseYamlSource } from '../../vendor/yaml/browser/index.js';

export interface FrontMatterValue {
  data: unknown;
  parseError: string | null;
}

/** Turns the YAML body of the front matter (the part without the --- fences) into a value. Never throws, even on failure. */
export function parseFrontMatterValue(raw: string): FrontMatterValue {
  try {
    return { data: parseYamlSource(raw) ?? null, parseError: null };
  } catch (error) {
    return { data: null, parseError: error instanceof Error ? error.message : String(error) };
  }
}
