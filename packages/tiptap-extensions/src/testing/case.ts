import type { JSONContent } from '@tiptap/core';

import type { DriverName, EditorDriver } from './driver';
import { loadMarkdown, serializeDoc } from './editor-io';
import {
  CARET,
  hasSelectionMarks,
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
  /** The document after the steps, as ProseMirror prints it: `doc(paragraph("a"))`. */
  doc?: string;
  /** Matched as a subset of the document's content, for checking attributes. */
  json?: readonly JSONContent[];
  /**
   * Why the editor does not behave like this yet. The case then has to fail,
   * so fixing the behaviour without removing the reason is caught.
   */
  fails?: string | Partial<Record<DriverName, string>>;
  /** Limits the case to one environment. */
  only?: DriverName;
}

export interface CaseResult {
  markdown: string;
  doc: string;
  json: JSONContent[];
}

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
  return testCase.given.replaceAll(CARET, '');
}

export function failureReason(
  testCase: EditorCase,
  driver: DriverName,
): string | undefined {
  return typeof testCase.fails === 'string'
    ? testCase.fails
    : testCase.fails?.[driver];
}

export async function runCase(
  driver: EditorDriver,
  testCase: EditorCase,
): Promise<CaseResult> {
  const { editor } = driver;
  loadMarkdown(editor, testCase.given);
  takeSelectionMarks(editor);
  for (const step of stepsOf(testCase)) {
    try {
      await driver.perform(step);
    } catch (cause) {
      throw new Error(`Could not ${describeStep(step)}`, { cause });
    }
  }
  editor.state.doc.check();
  return {
    markdown: hasSelectionMarks(expectedMarkdown(testCase))
      ? serializeWithSelectionMarks(editor)
      : serializeDoc(editor, editor.state.doc),
    doc: editor.state.doc.toString(),
    json: editor.getJSON().content ?? [],
  };
}
