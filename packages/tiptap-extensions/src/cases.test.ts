import { suites } from './cases';
import { PubExtensions } from './index';
import { createNodeDriver } from './testing/node-driver';
import { describeCases } from './testing/vitest';

describeCases(
  { name: 'node' },
  () => createNodeDriver([PubExtensions.configure({})]),
  suites,
);
