import type { ParsedFile } from '../parse/parsed-file.ts';
import { findH2Section } from '../parse/sections.ts';
import { PHASE_STATES } from '../schema/file-types.ts';
import { fileMap, lineAnchor } from './corpus-helpers.ts';
import { frontMatterKeyRange, isRecord } from './helpers.ts';
import type { CorpusRuleContext, RuleDiagnostic, RuleModule } from './types.ts';

interface RoadmapPhase {
  id: string;
  state: string;
  line: number;
}

interface IndexRow {
  id: string;
  state: string;
  line: number;
}

interface PhaseDir {
  name: string;
  id: string | null;
  statusFile: ParsedFile | null;
}

const SYNC_SUGGESTION =
  'Update roadmap.md, Phase Index, and phases/ so all three agree with what the session records say happened.';

/** Picks up the phases that carry a state from the H3 headings in the roadmap.md Phases section (a broken shape belongs to FM-2 and ID-3). */
function roadmapPhases(roadmap: ParsedFile): RoadmapPhase[] {
  const markdown = roadmap.markdown;
  if (!markdown) return [];
  const out: RoadmapPhase[] = [];
  for (const heading of markdown.headings) {
    if (heading.depth !== 3) continue;
    const id = /^(P\d{4})(?!\d):/.exec(heading.text)?.[1];
    if (!id) continue;
    const state = /—\s*(\S+)\s*$/u.exec(heading.text)?.[1] ?? '';
    if (!(PHASE_STATES as readonly string[]).includes(state)) continue;
    out.push({ id, state, line: heading.range.start.line });
  }
  return out;
}

/** Picks up the data rows of the Phase Index table in the root status.md (null when the section is missing — that belongs to STRUCT-1). */
function phaseIndexRows(root: ParsedFile): { rows: IndexRow[]; headingLine: number } | null {
  if (!root.markdown) return null;
  const section = findH2Section(root.markdown, root.lineCount, 'Phase Index');
  if (!section) return null;
  const rows: IndexRow[] = [];
  for (let line = section.bodyStartLine; line < section.bodyEndLine; line++) {
    const text = root.lines[line] ?? '';
    if (!/^\|.*\|\s*$/.test(text)) continue;
    const cells = text.replace(/^\||\|\s*$/g, '').split('|').map((c) => c.trim());
    const id = /^(P\d{4})(?!\d)\b/.exec(cells[0] ?? '')?.[1];
    if (!id) continue; // The header, the separator, and any row outside the conventions (the table structure belongs to TXT-2)
    rows.push({ id, state: cells[1] ?? '', line });
  }
  return { rows, headingLine: section.heading.range.start.line };
}

/** Derives the directories directly under phases/ from entries (an empty directory is invisible to git, so it is out of scope). */
function phaseDirs(context: CorpusRuleContext, byPath: Map<string, ParsedFile>): PhaseDir[] {
  const names = new Set<string>();
  for (const entry of context.corpus.entries) {
    const name = /^roadmap\/phases\/([^/]+)\//.exec(entry.relPath)?.[1];
    if (name) names.add(name);
  }
  return [...names].sort().map((name) => ({
    name,
    id: /^(P\d{4})(?!\d)/.exec(name)?.[1] ?? null,
    statusFile: byPath.get(`roadmap/phases/${name}/status.md`) ?? null,
  }));
}

/** ID-2: the three-way phase check — roadmap.md against Phase Index against phases/. */
export const id2: RuleModule = {
  id: 'ID-2',
  description: 'Phase agreement across roadmap.md, Phase Index, and phases/',
  defaultSeverity: 'error',
  defaultOptions: {},
  checkCorpus(context) {
    const { files } = context;
    const byPath = fileMap(files);
    const roadmap = files.find((f) => f.type === 'roadmap');
    const root = files.find((f) => f.type === 'root-status');
    if (!roadmap || !root) return []; // A missing file itself is a FILE-rule matter, or a matter of what was walked
    const phases = roadmapPhases(roadmap);
    const phaseById = new Map(phases.map((p) => [p.id, p]));
    const index = phaseIndexRows(root);
    const dirs = phaseDirs(context, byPath);
    const dirById = new Map(dirs.filter((d) => d.id).map((d) => [d.id as string, d]));
    const out: RuleDiagnostic[] = [];

    if (index) {
      const rowById = new Map(index.rows.map((r) => [r.id, r]));
      for (const phase of phases) {
        if (!rowById.has(phase.id)) {
          out.push({
            anchor: lineAnchor(byPath, root.relPath, index.headingLine),
            message: `Missing a Phase Index row for ${phase.id} (roadmap.md says \`${phase.state}\`).`,
            suggestion: SYNC_SUGGESTION,
          });
        }
      }
      for (const row of index.rows) {
        const phase = phaseById.get(row.id);
        if (!phase) {
          out.push({
            anchor: lineAnchor(byPath, root.relPath, row.line),
            message: `Missing a heading for ${row.id} in the roadmap.md Phases section.`,
            suggestion: SYNC_SUGGESTION,
          });
        } else if (phase.state !== row.state) {
          out.push({
            anchor: lineAnchor(byPath, root.relPath, row.line),
            message: `Inconsistent state for ${row.id}: roadmap.md says \`${phase.state}\`, Phase Index says \`${row.state}\`.`,
            suggestion: SYNC_SUGGESTION,
          });
        }
      }
    }

    // active and done require a directory (planned / dropped / blocked do not)
    for (const phase of phases) {
      if ((phase.state === 'active' || phase.state === 'done') && !dirById.has(phase.id)) {
        out.push({
          anchor: lineAnchor(byPath, roadmap.relPath, phase.line),
          message: `Missing a phases/ directory for ${phase.id} (roadmap.md says \`${phase.state}\`).`,
          suggestion: SYNC_SUGGESTION,
        });
      }
    }

    for (const dir of dirs) {
      if (!dir.id) continue; // A broken name belongs to ID-3
      if (!phaseById.has(dir.id)) {
        out.push({
          anchor: dir.statusFile
            ? { kind: 'file', file: dir.statusFile.relPath }
            : { kind: 'repo' },
          message: `Missing a phase heading in roadmap.md for phases/${dir.name}.`,
          suggestion: SYNC_SUGGESTION,
        });
      }
    }

    // `current_phase` has to be active in roadmap.md.
    // The one exception is the terminal state: once every phase is done or dropped there is no active
    // phase left to point at, so a `current_phase` naming a done phase is normal. The condition is
    // deliberately "every phase is done or dropped" rather than "no phase is active" — the latter would
    // also excuse a corpus whose only phase is blocked, which is a separate matter.
    const isComplete =
      phases.length > 0 && phases.every((p) => p.state === 'done' || p.state === 'dropped');
    const currentPhase = isRecord(root.markdown?.frontMatter?.data)
      ? root.markdown.frontMatter.data['current_phase']
      : undefined;
    if (typeof currentPhase === 'string') {
      const phase = phaseById.get(currentPhase);
      if (phase && phase.state !== 'active' && !(isComplete && phase.state === 'done')) {
        const range = frontMatterKeyRange(root, 'current_phase');
        out.push({
          anchor: range
            ? { kind: 'range', file: root.relPath, range }
            : { kind: 'file', file: root.relPath },
          message: `Unexpected state \`${phase.state}\` for \`current_phase\` ${currentPhase} in roadmap.md. Expected \`active\`.`,
          suggestion:
            'Update `current_phase` to the phase that is actually active, or fix the state in roadmap.md.',
        });
      }
    }

    // Agreement with the status.md inside the directory (the `phase` key and `state`)
    const allowedDirStates: Record<string, readonly string[]> = {
      active: ['active'],
      done: ['done'],
      dropped: ['dropped'],
      blocked: ['active'], // blocked is how roadmap.md puts it. The directory stays at the active it had while work was going on
    };
    for (const dir of dirs) {
      if (!dir.id || !dir.statusFile) continue;
      const data = dir.statusFile.markdown?.frontMatter?.data;
      if (!isRecord(data)) continue;
      const declaredPhase = data['phase'];
      if (
        typeof declaredPhase === 'string' &&
        /^P\d{4}$/.test(declaredPhase) &&
        declaredPhase !== dir.id
      ) {
        const range = frontMatterKeyRange(dir.statusFile, 'phase');
        out.push({
          anchor: range
            ? { kind: 'range', file: dir.statusFile.relPath, range }
            : { kind: 'file', file: dir.statusFile.relPath },
          message: `Inconsistent \`phase\`: the front matter says \`${declaredPhase}\`, the directory name says \`${dir.name}\`.`,
          suggestion:
            'Fix whichever is wrong — the session records show whether the `phase` key or the directory name is correct.',
        });
      }
      const roadmapState = phaseById.get(dir.id)?.state;
      const dirState = data['state'];
      const allowed = roadmapState ? allowedDirStates[roadmapState] : undefined;
      if (
        allowed &&
        typeof dirState === 'string' &&
        ['active', 'done', 'dropped'].includes(dirState) &&
        !allowed.includes(dirState)
      ) {
        const range = frontMatterKeyRange(dir.statusFile, 'state');
        out.push({
          anchor: range
            ? { kind: 'range', file: dir.statusFile.relPath, range }
            : { kind: 'file', file: dir.statusFile.relPath },
          message: `Inconsistent state for the phase: the phase status.md says \`${dirState}\`, roadmap.md says \`${roadmapState}\`.`,
          suggestion: SYNC_SUGGESTION,
        });
      }
    }
    return out;
  },
};
