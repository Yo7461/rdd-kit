import type { RuleModule } from './types.js';
import { fm1 } from './fm-1.js';
import { fm2 } from './fm-2.js';
import { fm3 } from './fm-3.js';
import { fm4 } from './fm-4.js';
import { size1, size2, size3, size6, size7 } from './size-limits.js';
import { size4 } from './size-4.js';
import { size5 } from './size-5.js';
import { struct1 } from './struct-1.js';
import { struct2 } from './struct-2.js';
import { struct3 } from './struct-3.js';
import { struct4 } from './struct-4.js';
import { id1 } from './id-1.js';
import { id2 } from './id-2.js';
import { id3 } from './id-3.js';
import { ref1 } from './ref-1.js';
import { ref2 } from './ref-2.js';
import { bid1, bid2, bid3 } from './bid.js';
import { file1 } from './file-1.js';
import { txt1 } from './txt-1.js';
import { txt2 } from './txt-2.js';
import { txt3 } from './txt-3.js';
import { git1, git2, git3, git4, git5, git6 } from './git-rules.js';
import { git7 } from './git-7.js';
import { ref3 } from './ref-3.js';

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
