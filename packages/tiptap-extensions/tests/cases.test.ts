import { PubExtensions } from '../src/index';
import { createNodeDriver } from '../testing/node-driver';
import { describeCases } from '../testing/vitest';
import { suites } from './cases/suites';

describeCases(
  { name: 'node' },
  () => createNodeDriver([PubExtensions.configure({})]),
  suites,
);
