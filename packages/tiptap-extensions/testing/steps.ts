import type { Editor } from '@tiptap/core';

export type Step =
  | { kind: 'type'; text: string }
  | { kind: 'press'; key: string }
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

export function paste(data: { text?: string; html?: string }): Step {
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
    case 'paste':
      return `paste ${JSON.stringify(step.html ?? step.text ?? '')}`;
    case 'compose':
      return `compose ${JSON.stringify(step.commit)}`;
    case 'run':
      return step.label;
  }
}
