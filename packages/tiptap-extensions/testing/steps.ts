import type { Editor } from '@tiptap/core';

export type Step =
  | { kind: 'type'; text: string }
  | { kind: 'press'; key: string }
  | { kind: 'select'; marked: string }
  | { kind: 'copy' }
  | { kind: 'cut' }
  | { kind: 'paste'; text?: string; html?: string }
  | { kind: 'compose'; updates: readonly string[]; commit: string }
  | { kind: 'run'; label: string; run: (editor: Editor) => void };

/** A bare string in a case's steps is typed as is. */
export type StepInput = Step | string;

export function type(text: string): Step {
  return { kind: 'type', text };
}

/** `key` is in TipTap shortcut notation: `Enter`, `Shift-Tab`, `Mod-b`. */
export function press(key: string): Step {
  return { kind: 'press', key };
}

/**
 * Selects what the marks mark in `marked`, the markdown the document is
 * saved as with the selection written as marks, as in a case's `expect`.
 */
export function select(marked: string): Step {
  return { kind: 'select', marked };
}

/** Copies the selection as the user does, onto the driver's clipboard. */
export function copy(): Step {
  return { kind: 'copy' };
}

export function cut(): Step {
  return { kind: 'cut' };
}

/** Pastes the data, or what the clipboard holds when there is none. */
export function paste(data: { text?: string; html?: string } = {}): Step {
  return { kind: 'paste', ...data };
}

/**
 * An IME composition: each update replaces the text being composed, and
 * `commit` is what the composition ends with (the last update by default).
 */
export function compose(updates: readonly string[], commit?: string): Step {
  const last = updates.at(-1);
  if (last === undefined) {
    throw new Error('A composition needs at least one update');
  }
  return { kind: 'compose', updates, commit: commit ?? last };
}

export function run(label: string, fn: (editor: Editor) => void): Step {
  return { kind: 'run', label, run: fn };
}

export function toStep(input: StepInput): Step {
  return typeof input === 'string' ? type(input) : input;
}

export function describeStep(step: Step): string {
  switch (step.kind) {
    case 'type':
      return `type ${JSON.stringify(step.text)}`;
    case 'press':
      return `press ${step.key}`;
    case 'select':
      return `select ${JSON.stringify(step.marked)}`;
    case 'copy':
    case 'cut':
      return step.kind;
    case 'paste':
      return step.html === undefined && step.text === undefined
        ? 'paste the clipboard'
        : `paste ${JSON.stringify(step.html ?? step.text)}`;
    case 'compose':
      return `compose ${JSON.stringify(step.commit)}`;
    case 'run':
      return step.label;
  }
}
