import { describe, expect, it } from 'vitest';

import {
  type EditorCase,
  expectedMarkdown,
  failureReason,
  runCase,
  stepsOf,
} from './case';
import type { DriverFactory, DriverName } from './driver';

export interface CaseSuite {
  title: string;
  cases: readonly EditorCase[];
}

/** Registers every case of the suites as a test that runs on `createDriver`. */
export function describeCases(
  driverName: DriverName,
  createDriver: DriverFactory,
  suites: readonly CaseSuite[],
): void {
  for (const suite of suites) {
    describe(suite.title, () => {
      for (const testCase of suite.cases) {
        if (testCase.only && testCase.only !== driverName) {
          continue;
        }
        const reason = failureReason(testCase, driverName);
        const register = reason ? it.fails : it;
        const name = reason ? `${testCase.name} (${reason})` : testCase.name;
        register(name, async (context) => {
          const driver = await createDriver();
          try {
            if (!stepsOf(testCase).every((step) => driver.supports(step))) {
              context.skip();
            }
            const result = await runCase(driver, testCase);
            expect(result.markdown).toBe(expectedMarkdown(testCase));
            if (testCase.doc !== undefined) {
              expect(result.doc).toBe(testCase.doc);
            }
            if (testCase.json !== undefined) {
              expect(result.json).toMatchObject(testCase.json);
            }
          } finally {
            driver.destroy();
          }
        });
      }
    });
  }
}
