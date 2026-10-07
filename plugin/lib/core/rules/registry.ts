import type { RuleModule } from './types.ts';
import { fm1 } from './fm-1.ts';
import { fm2 } from './fm-2.ts';
import { fm3 } from './fm-3.ts';
import { fm4 } from './fm-4.ts';
import { size1, size2, size3, size6, size7 } from './size-limits.ts';
import { size4 } from './size-4.ts';
import { size5 } from './size-5.ts';
import { struct1 } from './struct-1.ts';
import { struct2 } from './struct-2.ts';
import { struct3 } from './struct-3.ts';
import { struct4 } from './struct-4.ts';
import { id1 } from './id-1.ts';
import { id2 } from './id-2.ts';
import { id3 } from './id-3.ts';
import { ref1 } from './ref-1.ts';
import { ref2 } from './ref-2.ts';
import { bid1, bid2, bid3 } from './bid.ts';
import { file1 } from './file-1.ts';
import { txt1 } from './txt-1.ts';
import { txt2 } from './txt-2.ts';
import { txt3 } from './txt-3.ts';
import { git1, git2, git3, git4, git5, git6 } from './git-rules.ts';
import { git7 } from './git-7.ts';
import { ref3 } from './ref-3.ts';

export const allRules: readonly RuleModule[] = [
  fm1,
  fm2,
  fm3,
  fm4,
  size1,
  size2,
  size3,
  size4,
  size5,
  size6,
  size7,
  struct1,
  struct2,
  struct3,
  struct4,
  id1,
  id2,
  id3,
  ref1,
  ref2,
  ref3,
  bid1,
  bid2,
  bid3,
  file1,
  txt1,
  txt2,
  txt3,
  git1,
  git2,
  git3,
  git4,
  git5,
  git6,
  git7,
];
