import type { CaseSuite } from '../testing/vitest';
import { inputSuites } from './input.cases';
import { markdownSuites } from './markdown.cases';
import { savingSuites } from './saving.cases';
import { vfmSuites } from './vfm.cases';

export const suites: CaseSuite[] = [
  ...markdownSuites,
  ...vfmSuites,
  ...inputSuites,
  ...savingSuites,
];
