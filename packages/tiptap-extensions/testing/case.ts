import type { Editor, JSONContent } from '@tiptap/core';

import {
  type BrowserEngine,
  type DriverName,
  type DriverTarget,
  type EditorDriver,
  UnsupportedStep,
} from './driver';
import { loadMarkdown, serializeDoc } from './editor-io';
import {
  CARET,
  countSelectionMarks,
  hasSelectionMarks,
  removeSelectionMarks,
  serializeWithSelectionMarks,
  takeSelectionMarks,
} from './selection-marks';
import { describeStep, type Step, type StepInput, toStep } from './steps';

export interface EditorCase {
  name: string;
  /** Markdown the document is loaded from. May hold selection marks. */
  given: string;
  steps?: readonly StepInput[];
  /**
   * Markdown the document is saved as after the steps. Defaults to `given`
   * without its marks, i.e. a lossless round trip. The selection is only
   * compared when this holds marks.
   */
  expect?: string;
  /**
   * The document after the steps, as ProseMirror prints it:
   * `doc(paragraph("a"))`. The print leaves attributes out; check them with
   * `json`.
   */
  doc?: string;
  /**
   * The document's content as JSON. An object only has to have the keys it
   * gives, but an array has to list every item.
   */
  json?: readonly JSONContent[];
  /**
   * Why the editor does not behave like this yet. The case then has to fail,
   * so fixing the behaviour without removing the reason is caught. A browser
   * engine's key takes precedence over the `browser` key.
   */
  fails?: string | Partial<Record<DriverName | BrowserEngine, string>>;
  /** Limits the case to one environment. */
  only?: DriverName;
}

/** Where the editor does not do what a case expects. */
export type Mismatch =
  | { label: string; actual: unknown; expected: unknown }
  | { label: string; error: RangeError };

export function stepsOf(testCase: EditorCase): Step[] {
  return (testCase.steps ?? []).map(toStep);
}

export function expectedMarkdown(testCase: EditorCase): string {
  if (testCase.expect !== undefined) {
    return testCase.expect;
  }
  if (testCase.steps?.length) {
    throw new Error(`Case "${testCase.name}" has steps but no \`expect\``);
  }
  return removeSelectionMarks(testCase.given);
}

export function failureReason(
  testCase: EditorCase,
  target: DriverTarget,
): string | undefined {
  const { fails } = testCase;
  if (typeof fails === 'string') {
    return fails;
  }
  return (target.engine && fails?.[target.engine]) ?? fails?.[target.name];
}

// Keeps only the parts of `actual` that `expected` names, so that comparing
// the two checks `expected` as a subset and a diff shows no unrelated keys.
function pick(actual: unknown, expected: unknown): unknown {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    return actual.map((item, index) => pick(item, expected[index]));
  }
  if (
    expected !== null &&
    typeof expected === 'object' &&
    !Array.isArray(expected) &&
    actual !== null &&
    typeof actual === 'object' &&
    !Array.isArray(actual)
  ) {
    return Object.fromEntries(
      Object.keys(expected)
        .filter((key) => key in actual)
        .map((key) => [
          key,
          pick(
            (actual as Record<string, unknown>)[key],
            (expected as Record<string, unknown>)[key],
          ),
        ]),
    );
  }
  return actual;
}

function invalidDocument(label: string, check: () => void): Mismatch[] {
  try {
    check();
    return [];
  } catch (error) {
    if (error instanceof RangeError) {
      return [{ label, error }];
    }
    throw error;
  }
}

function loadSelectingMarks(editor: Editor, given: string): void {
  const marks = countSelectionMarks(given);
  if (marks === 0) {
    loadMarkdown(editor, given);
    return;
  }
  loadMarkdown(editor, removeSelectionMarks(given));
  const unmarked = editor.state.doc;
  loadMarkdown(editor, given);
  const found = takeSelectionMarks(editor);
  if (found !== marks) {
    throw new Error(
      `\`given\` has ${marks} ${CARET} marks, but ${found} in the document's text`,
    );
  }
  if (!editor.state.doc.eq(unmarked)) {
    throw new Error(
      `The ${CARET} marks change how \`given\` is parsed: ${editor.state.doc} instead of ${unmarked}. Move them away from \`*\` and \`_\`.`,
    );
  }
}

/**
 * Runs the case and returns where the editor differs from it. A mistake in
 * the case or a step the driver cannot perform is thrown instead.
 */
export async function runCase(
  driver: EditorDriver,
  testCase: EditorCase,
): Promise<Mismatch[]> {
  const { editor } = driver;
  const steps = stepsOf(testCase);
  const expected = expectedMarkdown(testCase);
  if (steps.length > 0 && !hasSelectionMarks(testCase.given)) {
    throw new Error(
      `Case "${testCase.name}" has steps but no ${CARET} mark in \`given\` to apply them at`,
    );
  }
  const loading = invalidDocument('loading `given`', () =>
    loadSelectingMarks(editor, testCase.given),
  );
  if (loading.length > 0) {
    return loading;
  }
  for (const step of steps) {
    try {
      await driver.perform(step);
    } catch (cause) {
      if (cause instanceof UnsupportedStep) {
        throw cause;
      }
      throw new Error(`Could not ${describeStep(step)}`, { cause });
    }
  }
  const { doc } = editor.state;
  const mismatches = invalidDocument('the document', () => doc.check());
  const compare = (label: string, actual: unknown, wanted: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
      mismatches.push({ label, actual, expected: wanted });
    }
  };
  if (hasSelectionMarks(expected)) {
    compare(
      'markdown with the selection',
      serializeWithSelectionMarks(editor),
      expected,
    );
  }
  compare(
    'markdown',
    serializeDoc(editor, doc),
    removeSelectionMarks(expected),
  );
  if (testCase.doc !== undefined) {
    compare('doc', doc.toString(), testCase.doc);
  }
  if (testCase.json !== undefined) {
    const content = editor.getJSON().content ?? [];
    compare('json', pick(content, testCase.json), testCase.json);
  }
  return mismatches;
}
