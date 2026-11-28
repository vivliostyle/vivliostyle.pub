// @vitest-environment happy-dom

import { PubExtensions } from '../src/index';
import { createDomDriver } from '../testing/dom-driver';
import { describeCases } from '../testing/vitest';
import { suites } from './cases/suites';

describeCases(
  { name: 'dom' },
  () => createDomDriver([PubExtensions.configure({})]),
  suites,
);
