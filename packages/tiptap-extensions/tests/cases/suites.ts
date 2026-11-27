import type { CaseSuite } from '../../testing/vitest';
import { inputSuites } from './input.cases';
import { markdownSuites } from './markdown.cases';
import { vfmSuites } from './vfm.cases';

export const suites: CaseSuite[] = [
  ...markdownSuites,
  ...vfmSuites,
  ...inputSuites,
];
