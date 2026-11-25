import type { CaseSuite } from '../../testing/vitest';
import { inputSuites } from './input.cases';
import { markdownSuites } from './markdown.cases';
import { savingSuites } from './saving.cases';
import { vfmSuites } from './vfm.cases';
import { vfmBlockSuites } from './vfm-blocks.cases';

export const suites: CaseSuite[] = [
  ...markdownSuites,
  ...vfmSuites,
  ...vfmBlockSuites,
  ...inputSuites,
  ...savingSuites,
];
