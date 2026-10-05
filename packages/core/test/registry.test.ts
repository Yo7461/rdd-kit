import { describe, expect, it } from 'vitest';
import { allRules } from '../src/rules/registry.js';

/**
 * The implemented ruleset, written out by hand so that a rule added to or dropped from the registry
 * fails here until this list follows: front matter, size, and structure (FM / SIZE / STRUCT); IDs,
 * references, bidirectional references, and file placement (ID / REF / BID / FILE); and text and git
 * (TXT / GIT).
 */
const EXPECTED_RULES = [
  'FM-1', 'FM-2', 'FM-3', 'FM-4',
  'SIZE-1', 'SIZE-2', 'SIZE-3', 'SIZE-4', 'SIZE-5', 'SIZE-6', 'SIZE-7',
  'STRUCT-1', 'STRUCT-2', 'STRUCT-3', 'STRUCT-4',
  'ID-1', 'ID-2', 'ID-3',
  'REF-1', 'REF-2', 'REF-3',
  'BID-1', 'BID-2', 'BID-3',
  'FILE-1',
  'TXT-1', 'TXT-2', 'TXT-3',
  'GIT-1', 'GIT-2', 'GIT-3', 'GIT-4', 'GIT-5', 'GIT-6', 'GIT-7',
];

describe('registry: the implemented ruleset matches the expected list', () => {
  it('implements exactly the expected ruleset, with nothing missing or extra', () => {
    const ids = allRules.map((r) => r.id);
    expect(new Set(ids)).toEqual(new Set(EXPECTED_RULES));
    expect(ids).toHaveLength(EXPECTED_RULES.length);
  });

  it('every rule implements at least one of check and checkCorpus', () => {
    for (const rule of allRules) {
      expect(rule.check ?? rule.checkCorpus, rule.id).toBeDefined();
    }
  });
});
