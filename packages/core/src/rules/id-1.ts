import type { IdDefinition } from '../corpus/index.js';
import { definitionAnchor, describeDefinitionPlace, fileMap } from './corpus-helpers.js';
import type { RuleDiagnostic, RuleModule } from './types.js';

/** ID-1: an ID defined twice. A gap is normal, except a gap in S numbers, which is a warning. */
export const id1: RuleModule = {
  id: 'ID-1',
  description: 'Duplicate ID definitions, and gaps in session numbers',
  defaultSeverity: 'error',
  defaultOptions: { warnSessionGaps: true },
  checkCorpus({ files, corpus, options }) {
    const byPath = fileMap(files);
    const out: RuleDiagnostic[] = [];

    for (const [id, defs] of corpus.definitions) {
      // A duplicate within the same shape (via) = error (diagnosed on the second and later ones)
      const byVia = new Map<string, IdDefinition[]>();
      for (const def of defs) {
        const list = byVia.get(def.via);
        if (list) list.push(def);
        else byVia.set(def.via, [def]);
      }
      for (const group of byVia.values()) {
        const first = group[0] as IdDefinition;
        for (const dup of group.slice(1)) {
          out.push({
            anchor: definitionAnchor(byPath, dup),
            message: `Duplicate definition of ${id} (first defined at ${describeDefinitionPlace(first)}).`,
            suggestion:
              'Move the later definition to the next free number instead of renumbering IDs. The session records show which one came later.',
          });
        }
      }
      // A C listed twice (a domain file heading × map.md Invariants) = warning
      if (id.startsWith('C') && byVia.has('heading') && byVia.has('invariant-line')) {
        const invariant = defs.find((d) => d.via === 'invariant-line') as IdDefinition;
        const heading = defs.find((d) => d.via === 'heading') as IdDefinition;
        out.push({
          severity: 'warning',
          anchor: definitionAnchor(byPath, invariant),
          message: `Duplicate definition of ${id} in a spec domain file (${describeDefinitionPlace(heading)}) and in map.md Invariants (no single source of truth).`,
          suggestion:
            'Move it to one place: map.md Invariants for a cross-cutting promise, a domain file for a contract on a specific interface.',
        });
      }
    }

    // A gap in S numbers = warning (a sign of a lost record or a numbering mistake. Session IDs are sequential, so it normally cannot happen)
    if (options['warnSessionGaps'] !== false) {
      const sessionNumbers = [...corpus.definitions.keys()]
        .filter((id) => /^S\d{4}$/.test(id))
        .map((id) => Number(id.slice(1)))
        .sort((a, b) => a - b);
      const min = sessionNumbers[0];
      const max = sessionNumbers[sessionNumbers.length - 1];
      if (min !== undefined && max !== undefined) {
        const defined = new Set(sessionNumbers);
        for (let n = min + 1; n < max; n++) {
          if (defined.has(n)) continue;
          const id = `S${String(n).padStart(4, '0')}`;
          out.push({
            severity: 'warning',
            anchor: { kind: 'repo' },
            message: `Missing session number ${id}. Session IDs are sequential, so this suggests a lost record or a numbering mistake.`,
            suggestion:
              'Check where the session log went — restore it if it was lost, or fix the numbering from here on. Use `warnSessionGaps: false` in the config if the gap is intentional.',
          });
        }
      }
    }
    return out;
  },
};
