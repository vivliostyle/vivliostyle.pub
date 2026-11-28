import { describe, expect, it } from 'vitest';

import {
  type EditorCase,
  failureReason,
  type Mismatch,
  runCase,
  stepsOf,
} from './case';
import {
  type DriverFactory,
  type DriverTarget,
  UnsupportedStep,
} from './driver';

export interface CaseSuite {
  title: string;
  cases: readonly EditorCase[];
}

/**
 * Fails the test unless the mismatches match the case's `fails` reason: none
 * for a case that should pass, at least one for a case that should fail.
 */
export function assertOutcome(
  mismatches: readonly Mismatch[],
  reason: string | undefined,
): void {
  if (reason !== undefined) {
    if (mismatches.length === 0) {
      throw new Error(
        `The case passes now, so remove its \`fails\` reason: ${reason}`,
      );
    }
    return;
  }
  for (const mismatch of mismatches) {
    if ('error' in mismatch) {
      expect
        .soft(() => {
          throw mismatch.error;
        }, mismatch.label)
        .not.toThrow();
    } else {
      expect.soft(mismatch.actual, mismatch.label).toEqual(mismatch.expected);
    }
  }
}

/** Registers every case of the suites as a test that runs on `createDriver`. */
export function describeCases(
  target: DriverTarget,
  createDriver: DriverFactory,
  suites: readonly CaseSuite[],
): void {
  for (const suite of suites) {
    describe(suite.title, () => {
      for (const testCase of suite.cases) {
        if (testCase.only && testCase.only !== target.name) {
          continue;
        }
        const reason = failureReason(testCase, target);
        const name = reason ? `${testCase.name} (${reason})` : testCase.name;
        it(name, async (context) => {
          const driver = await createDriver();
          try {
            if (!stepsOf(testCase).every((step) => driver.supports(step))) {
              context.skip();
            }
            let mismatches: Mismatch[];
            try {
              mismatches = await runCase(driver, testCase);
            } catch (error) {
              if (error instanceof UnsupportedStep) {
                context.skip(error.message);
              }
              throw error;
            }
            assertOutcome(mismatches, reason);
          } finally {
            driver.destroy();
          }
        });
      }
    });
  }
}
