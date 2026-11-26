import { createHash } from 'node:crypto';
import { Editor, type Extensions } from '@tiptap/core';
import { UndoRedo } from '@tiptap/extensions';
import {
  Fragment,
  type Node as ProseMirrorNode,
  Slice,
} from '@tiptap/pm/model';
import {
  AllSelection,
  EditorState,
  NodeSelection,
  TextSelection,
} from '@tiptap/pm/state';
import { stringify } from '@vivliostyle/vfm';
import { parseDocument } from 'htmlparser2';

import { PubExtensions } from '../src/index';
import {
  currentNotations,
  getMarkdownWithResult,
  markdownPipeline,
  parseMarkdown,
  setDocumentNotations,
  setMarkdownBaseline,
} from '../src/markdown/extension';
import { splitSource } from '../src/markdown/source';
import { MarkdownWriteError } from '../src/markdown/write';
import { loadSelectingMarks } from '../testing/case';
import type { EditorDriver } from '../testing/driver';
import { loadMarkdown } from '../testing/editor-io';
import { documentHtml } from '../testing/html';
import {
  checkMarkdownProperties,
  readsBackAs,
  unexplainedDifferences,
} from '../testing/markdown-properties';
import { createNodeDriver } from '../testing/node-driver';
import {
  hasSelectionMarks,
  removeSelectionMarks,
  serializeWithSelectionMarks,
} from '../testing/selection-marks';
import { press, type Step, type as typeText } from '../testing/steps';

/** Bumped whenever a probe can get a different verdict for the same code. */
export const HARNESS_VERSION = 1;

export type ProbeStep =
  | string
  | { kind: 'type'; text: string }
  | { kind: 'press'; key: string }
  | { kind: 'command'; name: string; args?: unknown[]; returns?: boolean }
  | { kind: 'select'; anchor: number; head?: number }
  | { kind: 'select'; node: number }
  | { kind: 'select'; all: true }
  | {
      kind: 'select';
      text: string;
      nth?: number;
      at?: 'start' | 'end' | 'range';
    }
  | { kind: 'pasteText'; text: string }
  | { kind: 'pasteContent'; content: unknown[] }
  | { kind: 'save' }
  | { kind: 'reload' }
  | { kind: 'recordNotations'; without: string[] };

type ObjectStep = Exclude<ProbeStep, string>;
type StepOf<K extends ObjectStep['kind']> = Extract<ObjectStep, { kind: K }>;

export interface Probe {
  id?: string;
  /** Markdown the file holds when the editor opens it; `‸` marks the selection. */
  given: string;
  steps?: ProbeStep[];
  /** Markdown the final save should be, with `‸` marks to check the selection. */
  expect?: string;
  /** The document as ProseMirror prints it after the steps. */
  expectDoc?: string;
  options?: {
    /** Adds undo history, which the app gets from Yjs instead. */
    history?: boolean;
    /** Runs the slow saving-guarantee checks on `given` and the final save. */
    properties?: boolean;
  };
  note?: string;
}

export type Oracle =
  | 'step-threw'
  | 'invalid-document'
  | 'save-refused'
  | 'read-back'
  | 'judge'
  | 'baseline-given-up'
  | 'locality'
  | 'unstable-save'
  | 'properties'
  | 'unsafe-dom'
  | 'expectation'
  | 'hang';

export const ORACLES: readonly Oracle[] = [
  'step-threw',
  'invalid-document',
  'save-refused',
  'read-back',
  'judge',
  'baseline-given-up',
  'locality',
  'unstable-save',
  'properties',
  'unsafe-dom',
  'expectation',
  'hang',
];

export interface Violation {
  oracle: Oracle;
  /** Index of the step after which it was seen; -1 for `given`, `steps.length` for the final save. */
  step: number;
  detail: string;
  actual?: unknown;
  expected?: unknown;
}

export interface TraceEntry {
  step: number;
  description: string;
  doc: string;
  selection: unknown;
  returned?: boolean;
  saved?: string;
}

export interface Verdict {
  id: string | null;
  /**
   * `invalid-probe`: the probe itself is wrong (unknown command, bad
   * position). `unsupported`: the headless driver cannot perform a step.
   * Neither says anything about the editor.
   */
  status: 'clean' | 'violations' | 'invalid-probe' | 'unsupported';
  violations: Violation[];
  /** Observations that need a human or agent to judge; not bugs by themselves. */
  signals: Violation[];
  error?: string;
  saved: string | null;
  savedWithSelection: string | null;
  doc: string | null;
  strategy: string | null;
  html: { editor: string | null; vfm: string | null };
  trace: TraceEntry[];
  oracles: Oracle[];
  fingerprint: string;
  harnessVersion: number;
}

/** A mistake in the probe, not in the editor. */
export class ProbeError extends Error {
  override name = 'ProbeError';
}

class UnsupportedStep extends Error {
  override name = 'UnsupportedStep';
}

const extensionsOf = (probe: Probe): Extensions => [
  PubExtensions.configure({}),
  ...(probe.options?.history ? [UndoRedo] : []),
];

// With the plugins, as in the app; a headless editor's state has none.
function createPlainEditor(): Editor {
  const editor = new Editor({
    element: null,
    extensions: [PubExtensions.configure({})],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  });
  editor.view.updateState(
    editor.state.reconfigure({ plugins: editor.extensionManager.plugins }),
  );
  return editor;
}

// Loading the file is not something a user can undo, as in the app, where
// the document arrives through Yjs.
function forgetHistory(editor: Editor): void {
  const { doc, selection, plugins } = editor.state;
  editor.view.updateState(EditorState.create({ doc, selection, plugins }));
}

export function describeProbeStep(step: ProbeStep): string {
  if (typeof step === 'string') {
    return `type ${JSON.stringify(step)}`;
  }
  switch (step.kind) {
    case 'type':
      return `type ${JSON.stringify(step.text)}`;
    case 'press':
      return `press ${step.key}`;
    case 'command':
      return `command ${step.name}(${(step.args ?? []).map((it) => JSON.stringify(it)).join(', ')})`;
    case 'select':
      return `select ${JSON.stringify(step)}`;
    case 'pasteText':
      return `paste ${JSON.stringify(step.text)}`;
    case 'pasteContent':
      return `paste ${JSON.stringify(step.content)}`;
    case 'save':
      return 'save';
    case 'reload':
      return 'reload the saved file';
    case 'recordNotations':
      return `record the document as made without ${step.without.join(', ')}`;
  }
}

function selectionOf(editor: Editor): unknown {
  return editor.state.selection.toJSON();
}

function findText(
  doc: ProseMirrorNode,
  text: string,
  nth: number,
): number | undefined {
  const found: number[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) {
      return;
    }
    let index = node.text.indexOf(text);
    while (index !== -1) {
      found.push(pos + index);
      index = node.text.indexOf(text, index + 1);
    }
  });
  return found[nth];
}

function select(editor: Editor, step: StepOf<'select'>): void {
  const { doc, tr } = editor.state;
  const inRange = (pos: number) => {
    if (!Number.isInteger(pos) || pos < 0 || pos > doc.content.size) {
      throw new ProbeError(
        `Position ${pos} is outside the document (0-${doc.content.size})`,
      );
    }
    return pos;
  };
  if ('all' in step) {
    tr.setSelection(new AllSelection(doc));
  } else if ('node' in step) {
    const pos = inRange(step.node);
    if (!doc.nodeAt(pos)) {
      throw new ProbeError(`No node starts at ${pos}`);
    }
    tr.setSelection(NodeSelection.create(doc, pos));
  } else if ('text' in step) {
    const from = findText(doc, step.text, step.nth ?? 0);
    if (from === undefined) {
      throw new ProbeError(
        `The text ${JSON.stringify(step.text)} (#${step.nth ?? 0}) is not in one text node`,
      );
    }
    const to = from + step.text.length;
    const at = step.at ?? 'range';
    tr.setSelection(
      at === 'range'
        ? TextSelection.create(doc, from, to)
        : TextSelection.create(doc, at === 'start' ? from : to),
    );
  } else {
    tr.setSelection(
      TextSelection.create(
        doc,
        inRange(step.anchor),
        inRange(step.head ?? step.anchor),
      ),
    );
  }
  editor.view.dispatch(tr);
}

function runCommand(editor: Editor, step: StepOf<'command'>): boolean {
  const commands = editor.commands as unknown as Record<
    string,
    (...args: unknown[]) => boolean
  >;
  const command = commands[step.name];
  if (typeof command !== 'function') {
    throw new ProbeError(
      `There is no command ${step.name}; list them with \`pnpm bug-hunt commands\``,
    );
  }
  return Boolean(command(...(step.args ?? [])));
}

const SCRIPTING_ELEMENTS = new Set([
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'base',
  'meta',
  'link',
  'portal',
]);
const URL_ATTRIBUTES = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'xlink:href',
  'data',
  'poster',
  'background',
]);

/**
 * Markup in the editor's own DOM that could run script on the host page.
 * VFM keeps raw HTML as written for the book, which runs sandboxed, but the
 * editor renders on the app's origin.
 */
export function unsafeMarkup(html: string): string[] {
  const found: string[] = [];
  type DomNode = ReturnType<typeof parseDocument>['children'][number];
  const visit = (nodes: readonly DomNode[]) => {
    for (const node of nodes) {
      if (node.type !== 'tag' && node.type !== 'script') {
        continue;
      }
      const { name, attribs, children } = node as unknown as {
        name: string;
        attribs: Record<string, string>;
        children: DomNode[];
      };
      if (SCRIPTING_ELEMENTS.has(name.toLowerCase())) {
        found.push(`<${name}> element`);
      }
      for (const [key, value] of Object.entries(attribs)) {
        const attribute = key.toLowerCase();
        if (attribute.startsWith('on') || attribute === 'srcdoc') {
          found.push(`${attribute} attribute on <${name}>`);
        }
        // biome-ignore lint/suspicious/noControlCharactersInRegex: browsers ignore control characters and whitespace in a scheme
        const scheme = value.replace(/[\u0000- \u007f]/g, '').toLowerCase();
        if (
          URL_ATTRIBUTES.has(attribute) &&
          /^(javascript|vbscript|data:text\/html)/.test(scheme)
        ) {
          found.push(`${attribute}=${JSON.stringify(value)} on <${name}>`);
        }
      }
      visit(children ?? []);
    }
  };
  visit(parseDocument(html).children);
  return found;
}

function vfmHtml(markdown: string): string | null {
  try {
    return String(
      stringify(markdown, { partial: true, disableFormatHtml: true }),
    );
  } catch (error) {
    return `[VFM threw: ${String(error)}]`;
  }
}

/** Top-level blocks unchanged at the start and the end must keep their bytes. */
function localityProblem(
  editor: Editor,
  baseline: string,
  saved: string,
  doc: ProseMirrorNode,
): string | undefined {
  const base = splitSource(baseline);
  const out = splitSource(saved);
  const parsed = markdownPipeline(editor).parseBody(base.body);
  const before = parsed.doc;
  const limit = Math.min(before.childCount, doc.childCount);
  let prefix = 0;
  while (prefix < limit && before.child(prefix).eq(doc.child(prefix))) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    before
      .child(before.childCount - 1 - suffix)
      .eq(doc.child(doc.childCount - 1 - suffix))
  ) {
    suffix++;
  }
  const text = base.frontmatter + base.body;
  const result = out.frontmatter + out.body;
  if (prefix > 0) {
    const range = parsed.ranges.get(before.child(prefix - 1));
    if (range) {
      const kept = text.slice(0, base.frontmatter.length + range.end);
      if (!result.startsWith(kept)) {
        return `the ${prefix} unchanged block(s) at the start were rewritten`;
      }
    }
  }
  if (suffix > 0) {
    const range = parsed.ranges.get(before.child(before.childCount - suffix));
    if (range) {
      const kept = text.slice(base.frontmatter.length + range.start);
      if (!result.endsWith(kept)) {
        return `the ${suffix} unchanged block(s) at the end were rewritten`;
      }
    }
  }
  return undefined;
}

function fingerprintOf(probe: Probe, oracles: readonly Oracle[]): string {
  const canonical = JSON.stringify({
    given: probe.given,
    steps: probe.steps ?? [],
    options: probe.options ?? {},
    oracles,
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

function toDriverStep(step: ProbeStep): Step | undefined {
  if (typeof step === 'string') {
    return typeText(step);
  }
  if (step.kind === 'type') {
    return typeText(step.text);
  }
  if (step.kind === 'press') {
    return press(step.key);
  }
  return undefined;
}

class Session {
  readonly violations: Violation[] = [];
  readonly signals: Violation[] = [];
  readonly trace: TraceEntry[] = [];
  /** What the file on disk holds: `given`, then each successful save. */
  file: string;
  lastSave: { markdown: string; strategy: string } | null = null;
  /** Whether the document is recorded with other notations than the current ones. */
  recorded = false;

  constructor(
    readonly driver: EditorDriver,
    readonly probe: Probe,
  ) {
    this.file = removeSelectionMarks(probe.given);
  }

  get editor(): Editor {
    return this.driver.editor;
  }

  checkDocument(step: number): boolean {
    try {
      this.editor.state.doc.check();
      return true;
    } catch (error) {
      this.violations.push({
        oracle: 'invalid-document',
        step,
        detail: String(error),
        actual: String(this.editor.state.doc),
      });
      return false;
    }
  }

  /** Saves as the app does: on success the save becomes the baseline. */
  save(step: number): string | null {
    const { editor } = this;
    const doc = editor.state.doc;
    const baseline = this.file;
    let result: { markdown: string; strategy: string };
    try {
      result = getMarkdownWithResult(editor);
    } catch (error) {
      if (error instanceof MarkdownWriteError) {
        this.violations.push({
          oracle: 'save-refused',
          step,
          detail: error.message,
          actual: error.markdown,
          expected: String(doc),
        });
        return null;
      }
      throw error;
    }
    const { markdown, strategy } = result;
    if (strategy === 'generated') {
      this.violations.push({
        oracle: 'baseline-given-up',
        step,
        detail: 'the save gave up on the baseline and wrote the file anew',
        actual: markdown,
        expected: baseline,
      });
    }
    // Both read with the current notations, which mean more than an older
    // record does: there only a human can tell.
    const readBack = this.recorded ? this.signals : this.violations;
    if (!readsBackAs(editor, markdown, doc)) {
      readBack.push({
        oracle: 'read-back',
        step,
        detail: 'the saved markdown does not read back as the document',
        actual: String(parseMarkdown(editor, markdown).doc),
        expected: String(doc),
      });
    }
    const unexplained = unexplainedDifferences(editor, markdown, doc);
    if (unexplained.length > 0) {
      readBack.push({
        oracle: 'judge',
        step,
        detail: 'the independent judge finds differences on reading back',
        actual: unexplained,
        expected: String(doc),
      });
    }
    const locality = localityProblem(editor, baseline, markdown, doc);
    if (locality) {
      // Rewriting neighbours is how a repaired save is allowed to fix itself.
      (strategy === 'reused' ? this.violations : this.signals).push({
        oracle: 'locality',
        step,
        detail: `${locality} (strategy: ${strategy})`,
        actual: markdown,
        expected: baseline,
      });
    }
    setMarkdownBaseline(editor, markdown);
    this.file = markdown;
    this.lastSave = result;
    return markdown;
  }

  checkStable(step: number, markdown: string): void {
    const editor = createPlainEditor();
    try {
      loadMarkdown(editor, markdown);
      const again = getMarkdownWithResult(editor).markdown;
      if (again !== markdown) {
        this.violations.push({
          oracle: 'unstable-save',
          step,
          detail: 'opening the saved file and saving it unedited changes it',
          actual: again,
          expected: markdown,
        });
      }
    } catch (error) {
      this.violations.push({
        oracle: 'unstable-save',
        step,
        detail: `opening the saved file and saving it unedited throws: ${String(error)}`,
        expected: markdown,
      });
    } finally {
      editor.destroy();
    }
  }

  checkProperties(step: number, markdown: string, what: string): void {
    for (const violation of checkMarkdownProperties(
      createPlainEditor,
      markdown,
    )) {
      this.violations.push({
        oracle: 'properties',
        step,
        detail: `${what}: ${violation.property}, ${violation.detail}`,
        actual: violation.actual,
        expected: violation.expected,
      });
    }
  }

  async perform(step: ProbeStep, index: number): Promise<boolean | undefined> {
    const driverStep = toDriverStep(step);
    if (driverStep) {
      if (!this.driver.supports(driverStep)) {
        throw new UnsupportedStep(
          `The headless driver cannot ${describeProbeStep(step)}`,
        );
      }
      try {
        await this.driver.perform(driverStep);
      } catch (error) {
        // In a browser an unbound key does nothing the editor sees.
        if (String(error).includes('No keymap handles')) {
          throw new UnsupportedStep(String(error));
        }
        throw error;
      }
      return undefined;
    }
    const { editor } = this;
    const object = step as ObjectStep;
    switch (object.kind) {
      case 'command': {
        const returned = runCommand(editor, object);
        if (object.returns !== undefined && returned !== object.returns) {
          this.violations.push({
            oracle: 'expectation',
            step: index,
            detail: `${describeProbeStep(step)} returned ${returned}`,
            actual: returned,
            expected: object.returns,
          });
        }
        return returned;
      }
      case 'select':
        select(editor, object);
        return undefined;
      case 'pasteText': {
        const { from, to } = editor.state.selection;
        editor.view.dispatch(
          editor.state.tr
            .insertText(object.text, from, to)
            .setMeta('uiEvent', 'paste'),
        );
        return undefined;
      }
      case 'pasteContent': {
        let fragment: Fragment;
        try {
          fragment = Fragment.fromJSON(editor.schema, object.content);
        } catch (error) {
          throw new ProbeError(`\`content\` is not schema JSON: ${error}`);
        }
        editor.view.dispatch(
          editor.state.tr
            .replaceSelection(new Slice(fragment, 0, 0))
            .setMeta('uiEvent', 'paste'),
        );
        return undefined;
      }
      case 'save':
        this.save(index);
        return undefined;
      case 'reload':
        loadMarkdown(editor, this.file);
        forgetHistory(editor);
        return undefined;
      case 'recordNotations': {
        const { without } = object;
        if (!Array.isArray(without)) {
          throw new ProbeError('`without` must list notation names');
        }
        setDocumentNotations(
          editor,
          currentNotations(editor)
            .split(' ')
            .filter((entry) => !without.includes(entry.split('@')[0] ?? ''))
            .join(' '),
        );
        this.recorded = true;
        return undefined;
      }
      default:
        throw new ProbeError(`Unknown step ${JSON.stringify(step)}`);
    }
  }
}

function validateProbe(probe: unknown): asserts probe is Probe {
  if (typeof probe !== 'object' || probe === null) {
    throw new ProbeError('A probe is an object');
  }
  const { given, steps } = probe as Record<string, unknown>;
  if (typeof given !== 'string') {
    throw new ProbeError('A probe needs `given` markdown');
  }
  if (steps !== undefined && !Array.isArray(steps)) {
    throw new ProbeError('`steps` is an array');
  }
}

/** Runs a probe on a fresh headless editor and checks every oracle. */
export async function runProbe(input: unknown): Promise<Verdict> {
  const verdict: Verdict = {
    id: null,
    status: 'clean',
    violations: [],
    signals: [],
    saved: null,
    savedWithSelection: null,
    doc: null,
    strategy: null,
    html: { editor: null, vfm: null },
    trace: [],
    oracles: [],
    fingerprint: '',
    harnessVersion: HARNESS_VERSION,
  };
  let probe: Probe;
  try {
    validateProbe(input);
    probe = input;
  } catch (error) {
    verdict.status = 'invalid-probe';
    verdict.error = String(error);
    return verdict;
  }
  verdict.id = probe.id ?? null;
  const steps = probe.steps ?? [];
  const driver = createNodeDriver(extensionsOf(probe));
  const session = new Session(driver, probe);
  const { editor } = session;
  const finish = (): Verdict => {
    verdict.violations = session.violations;
    verdict.signals = session.signals;
    verdict.trace = session.trace;
    verdict.oracles = [
      ...new Set(session.violations.map((it) => it.oracle)),
    ].sort();
    if (verdict.status === 'clean' && verdict.violations.length > 0) {
      verdict.status = 'violations';
    }
    verdict.fingerprint = fingerprintOf(probe, verdict.oracles);
    return verdict;
  };
  try {
    if (probe.options?.properties) {
      session.checkProperties(-1, session.file, '`given`');
    }
    try {
      loadSelectingMarks(editor, probe.given);
    } catch (error) {
      if (error instanceof RangeError) {
        session.violations.push({
          oracle: 'invalid-document',
          step: -1,
          detail: `loading \`given\`: ${String(error)}`,
        });
        return finish();
      }
      throw new ProbeError(String(error));
    }
    forgetHistory(editor);
    if (!session.checkDocument(-1)) {
      return finish();
    }
    for (const [index, step] of steps.entries()) {
      let returned: boolean | undefined;
      try {
        returned = await session.perform(step, index);
      } catch (error) {
        if (error instanceof ProbeError || error instanceof UnsupportedStep) {
          throw error;
        }
        // Parsing HTML or a string of content, or a paste event, needs a DOM.
        if (
          String(error).includes('no window object available') ||
          /^ReferenceError: (window|document|ClipboardEvent|DataTransfer|DOMParser|Element|HTMLElement|Node) is not defined/.test(
            String(error),
          )
        ) {
          throw new UnsupportedStep(
            `${describeProbeStep(step)} needs a DOM; use a pasteText or pasteContent step, or insert JSON without paste rules`,
          );
        }
        const cause = (error as Error)?.stack ?? String(error);
        session.violations.push({
          oracle: 'step-threw',
          step: index,
          detail: `${describeProbeStep(step)} threw: ${String(error)}`,
          actual: cause.split('\n').slice(0, 12).join('\n'),
        });
        return finish();
      }
      session.trace.push({
        step: index,
        description: describeProbeStep(step),
        doc: String(editor.state.doc),
        selection: selectionOf(editor),
        ...(returned !== undefined && { returned }),
        ...(typeof step === 'object' &&
          step.kind === 'save' && { saved: session.file }),
      });
      if (!session.checkDocument(index)) {
        return finish();
      }
    }

    const final = steps.length;
    const { doc } = editor.state;
    verdict.doc = String(doc);
    const saved = session.save(final);
    verdict.saved = saved;
    verdict.strategy = session.lastSave?.strategy ?? null;
    try {
      verdict.html.editor = documentHtml(doc);
      const unsafe = unsafeMarkup(verdict.html.editor);
      if (unsafe.length > 0) {
        session.violations.push({
          oracle: 'unsafe-dom',
          step: final,
          detail: 'the editor would put script-capable markup on the page',
          actual: unsafe,
        });
      }
    } catch (error) {
      verdict.html.editor = `[no HTML without a DOM: ${String(error)}]`;
    }
    if (saved !== null) {
      verdict.html.vfm = vfmHtml(saved);
      verdict.savedWithSelection =
        editor.state.selection instanceof TextSelection
          ? serializeWithSelectionMarks(editor)
          : null;
      session.checkStable(final, saved);
      if (probe.options?.properties) {
        session.checkProperties(final, saved, 'the final save');
      }
    }

    const compare = (detail: string, actual: unknown, expected: unknown) => {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        session.violations.push({
          oracle: 'expectation',
          step: final,
          detail,
          actual,
          expected,
        });
      }
    };
    if (probe.expect !== undefined) {
      if (hasSelectionMarks(probe.expect)) {
        compare(
          'markdown with the selection',
          verdict.savedWithSelection,
          probe.expect,
        );
      }
      compare('markdown', saved, removeSelectionMarks(probe.expect));
    }
    if (probe.expectDoc !== undefined) {
      compare('doc', verdict.doc, probe.expectDoc);
    }
    return finish();
  } catch (error) {
    if (error instanceof ProbeError) {
      verdict.status = 'invalid-probe';
    } else if (error instanceof UnsupportedStep) {
      verdict.status = 'unsupported';
    } else {
      // A check of the harness itself failed: report it, do not hide it.
      session.violations.push({
        oracle: 'step-threw',
        step: steps.length,
        detail: `checking the result threw: ${String(error)}`,
        actual: (error as Error)?.stack?.split('\n').slice(0, 12).join('\n'),
      });
      return finish();
    }
    verdict.error = String(error instanceof Error ? error.message : error);
    finish();
    verdict.violations = [];
    verdict.oracles = [];
    return verdict;
  } finally {
    driver.destroy();
  }
}

/** The editor's commands, for probes that call them by name. */
export function listCommands(): string[] {
  const editor = createPlainEditor();
  try {
    return Object.keys(editor.commands).sort();
  } finally {
    editor.destroy();
  }
}

/** The notations a new document is recorded with, as `name@version`. */
export function listNotations(): string[] {
  const editor = createPlainEditor();
  try {
    return currentNotations(editor).split(' ');
  } finally {
    editor.destroy();
  }
}

function keeps(verdict: Verdict, oracle: Oracle | undefined): boolean {
  return oracle
    ? verdict.oracles.includes(oracle)
    : verdict.status === 'violations';
}

/** Splits markdown at blank lines, keeping the separators with each chunk. */
function chunksOf(markdown: string): string[] {
  return markdown.split(/(?<=\n\n)/);
}

/**
 * Shrinks a probe while it still shows `oracle` (any violation by default):
 * fewer steps, fewer blocks of `given`, shorter typed text, fewer characters.
 * Greedy and bounded, so the result is small, not necessarily minimal.
 */
export async function minimizeProbe(
  input: Probe,
  { oracle, budget = 400 }: { oracle?: Oracle; budget?: number } = {},
): Promise<{ probe: Probe; verdict: Verdict; runs: number }> {
  // The slow checks only matter when they are what is being kept.
  const options = {
    ...input.options,
    properties: oracle === 'properties' || undefined,
  };
  let best: Probe = { ...input, options };
  let bestVerdict = await runProbe(best);
  let runs = 1;
  if (!keeps(bestVerdict, oracle)) {
    return { probe: input, verdict: bestVerdict, runs };
  }
  const attempt = async (candidate: Probe): Promise<boolean> => {
    if (runs >= budget) {
      return false;
    }
    runs++;
    const verdict = await runProbe(candidate);
    if (keeps(verdict, oracle)) {
      best = candidate;
      bestVerdict = verdict;
      return true;
    }
    return false;
  };
  let progress = true;
  while (progress && runs < budget) {
    progress = false;
    const steps = best.steps ?? [];
    for (let index = steps.length - 1; index >= 0; index--) {
      const fewer = (best.steps ?? []).filter((_, at) => at !== index);
      if (await attempt({ ...best, steps: fewer })) {
        progress = true;
      }
    }
    const chunks = chunksOf(best.given);
    for (
      let index = chunks.length - 1;
      index >= 0 && chunks.length > 1;
      index--
    ) {
      const current = chunksOf(best.given);
      if (index >= current.length || current[index].includes('‸')) {
        continue;
      }
      const given = current.filter((_, at) => at !== index).join('');
      if (await attempt({ ...best, given })) {
        progress = true;
      }
    }
    for (const [index, step] of (best.steps ?? []).entries()) {
      const text =
        typeof step === 'string'
          ? step
          : step.kind === 'type'
            ? step.text
            : undefined;
      if (text === undefined || text.length < 2) {
        continue;
      }
      const chars = Array.from(text);
      for (let at = chars.length - 1; at >= 0; at--) {
        const current = best.steps?.[index];
        const currentText =
          typeof current === 'string'
            ? current
            : current?.kind === 'type'
              ? current.text
              : '';
        const shorter = Array.from(currentText);
        if (at >= shorter.length || shorter.length < 2) {
          continue;
        }
        shorter.splice(at, 1);
        const nextSteps = [...(best.steps ?? [])];
        nextSteps[index] = shorter.join('');
        if (await attempt({ ...best, steps: nextSteps })) {
          progress = true;
        }
      }
    }
    const chars = Array.from(best.given);
    for (let at = chars.length - 1; at >= 0 && runs < budget; at--) {
      const current = Array.from(best.given);
      if (at >= current.length || current[at] === '‸') {
        continue;
      }
      current.splice(at, 1);
      if (await attempt({ ...best, given: current.join('') })) {
        progress = true;
      }
    }
  }
  return { probe: best, verdict: bestVerdict, runs };
}

const quote = (value: string) =>
  `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;

function caseStep(step: ProbeStep): string {
  if (typeof step === 'string') {
    return quote(step);
  }
  switch (step.kind) {
    case 'type':
      return quote(step.text);
    case 'press':
      return `press(${quote(step.key)})`;
    case 'command': {
      const args = (step.args ?? []).map((it) => JSON.stringify(it)).join(', ');
      const call = `editor.commands.${step.name}(${args})`;
      const body =
        step.returns === undefined
          ? `${call};`
          : `if (${step.returns ? '!' : ''}${call}) { throw new Error('unexpected result'); }`;
      return `run(${quote(describeProbeStep(step))}, (editor) => { ${body} })`;
    }
    case 'select':
      return `run(${quote(describeProbeStep(step))}, (editor) => { /* TODO: set the selection */ void editor; })`;
    case 'pasteText':
      return `run(${quote(describeProbeStep(step))}, (editor) => { editor.view.dispatch(editor.state.tr.insertText(${quote(step.text)}).setMeta('uiEvent', 'paste')); })`;
    case 'pasteContent':
      return `run(${quote(describeProbeStep(step))}, (editor) => { editor.view.dispatch(editor.state.tr.replaceSelection(new Slice(Fragment.fromJSON(editor.schema, ${JSON.stringify(step.content)}), 0, 0)).setMeta('uiEvent', 'paste')); })`;
    case 'save':
      return `run('save', (editor) => { setMarkdownBaseline(editor, getMarkdown(editor)); })`;
    case 'reload':
      return `run('reload the saved file', (editor) => { loadMarkdown(editor, getMarkdown(editor)); })`;
    case 'recordNotations':
      return `run(${quote(describeProbeStep(step))}, (editor) => { setDocumentNotations(editor, currentNotations(editor).split(' ').filter((entry) => !${JSON.stringify(step.without)}.includes(entry.split('@')[0] ?? '')).join(' ')); })`;
  }
}

/**
 * An editor behaviour case for `tests/cases/`, failing for `reason` until the
 * bug is fixed. Steps the case framework has no helper for become `run`
 * steps that may need finishing by hand.
 */
export function toEditorCase(
  name: string,
  probe: Probe,
  expected: string,
  reason: string,
): string {
  const lines = [
    '{',
    `  name: ${quote(name)},`,
    `  given: ${quote(probe.given)},`,
  ];
  if (probe.steps?.length) {
    lines.push(`  steps: [${probe.steps.map(caseStep).join(', ')}],`);
  }
  lines.push(`  expect: ${quote(expected)},`);
  if (probe.expectDoc !== undefined) {
    lines.push(`  doc: ${quote(probe.expectDoc)},`);
  }
  lines.push(`  fails: ${quote(reason)},`, '},');
  return lines.join('\n');
}
