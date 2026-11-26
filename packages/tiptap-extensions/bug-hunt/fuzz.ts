import {
  FRAGMENTS,
  HTML_ELEMENT_FRAGMENTS,
  HTML_ELEMENT_INSERTS,
  INSERTS,
  VFM_FRAGMENTS,
  VFM_INSERTS,
} from '../testing/markdown-properties';
import type { Probe, ProbeStep, Verdict } from './harness';

export type Corpus = 'markdown' | 'vfm' | 'html' | 'all';

export const CORPORA: readonly Corpus[] = ['markdown', 'vfm', 'html', 'all'];

// What the fragment lists leave out: the shapes of source and the characters
// that are easy to get wrong.
const EXTRA_FRAGMENTS = [
  'これは「**重要**」です。',
  '全角　空白と𠮷野家、👨‍👩‍👧、é',
  'ゼロ幅​スペース‍と﻿BOM',
  'a\r\nb\r\n\r\nc',
  '---\ntitle: t\n---\n\n本文',
  '- a\n  > quote\n  > - b',
  '> > nested\n> back',
  'tab\tseparated\ttext',
  'a  \n\\\n',
  '[link](<a b> "t") [p](a(b)c)',
  '&#x3042; &bogus; &#0;',
];

const EXTRA_INSERTS = [
  'あ',
  '𠮷',
  '　',
  '​',
  ' ',
  '\t',
  '`',
  '](u)',
  '{a|b}',
  '^[n]',
  'javascript:',
];

const KEYS = [
  'Enter',
  'Enter',
  'Backspace',
  'Backspace',
  'Delete',
  'Shift-Enter',
  'Tab',
  'Shift-Tab',
  'Mod-b',
  'Mod-i',
  'Mod-e',
  'Mod-Shift-s',
  'Mod-Alt-0',
  'Mod-Alt-1',
  'Mod-Shift-8',
  'Mod-Shift-7',
  'Mod-Shift-b',
];

// Commands with arguments of the types they declare, so a failure is the
// editor's and not the probe's.
const COMMANDS: ProbeStep[] = [
  { kind: 'command', name: 'toggleBold' },
  { kind: 'command', name: 'toggleItalic' },
  { kind: 'command', name: 'toggleCode' },
  { kind: 'command', name: 'toggleStrike' },
  { kind: 'command', name: 'toggleUnderline' },
  { kind: 'command', name: 'toggleBulletList' },
  { kind: 'command', name: 'toggleOrderedList' },
  { kind: 'command', name: 'toggleBlockquote' },
  { kind: 'command', name: 'toggleHeading', args: [{ level: 2 }] },
  { kind: 'command', name: 'toggleCodeBlock' },
  { kind: 'command', name: 'setParagraph' },
  { kind: 'command', name: 'setHardBreak' },
  { kind: 'command', name: 'setHorizontalRule' },
  { kind: 'command', name: 'setRuby', args: ['るび'] },
  { kind: 'command', name: 'unsetRuby' },
  { kind: 'command', name: 'unsetAllMarks' },
  { kind: 'command', name: 'clearNodes' },
  { kind: 'command', name: 'liftListItem', args: ['listItem'] },
  { kind: 'command', name: 'sinkListItem', args: ['listItem'] },
  { kind: 'command', name: 'splitListItem', args: ['listItem'] },
  { kind: 'command', name: 'joinBackward' },
  { kind: 'command', name: 'joinForward' },
  { kind: 'command', name: 'deleteSelection' },
  { kind: 'command', name: 'selectParentNode' },
  { kind: 'command', name: 'insertTableOfContents' },
  { kind: 'command', name: 'insertSectionEnd' },
];

const SELECT_ALL: ProbeStep = { kind: 'select', all: true };

function fragmentsOf(corpus: Corpus): {
  fragments: string[];
  inserts: string[];
} {
  const markdown = { fragments: FRAGMENTS, inserts: INSERTS };
  const vfm = { fragments: VFM_FRAGMENTS, inserts: VFM_INSERTS };
  const html = {
    fragments: HTML_ELEMENT_FRAGMENTS,
    inserts: HTML_ELEMENT_INSERTS,
  };
  const chosen =
    corpus === 'all'
      ? [markdown, vfm, html]
      : [{ markdown, vfm, html }[corpus]];
  return {
    fragments: [...chosen.flatMap((it) => it.fragments), ...EXTRA_FRAGMENTS],
    inserts: [...chosen.flatMap((it) => it.inserts), ...EXTRA_INSERTS],
  };
}

/** A PRNG of its own per probe, so any probe can be made again from its id. */
function random(seed: number): (below: number) => number {
  let state = seed >>> 0;
  return (below) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * below);
  };
}

function seedOf(seed: number, index: number): number {
  return (
    Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(index + 1, 0xc2b2ae35)
  );
}

export interface FuzzOptions {
  seed: number;
  corpus: Corpus;
  /** Most steps a probe gets. */
  steps: number;
  properties?: boolean;
}

function insertAt(text: string, at: number, insert: string): string {
  const chars = Array.from(text);
  chars.splice(at, 0, insert);
  return chars.join('');
}

/** The `index`th probe of a run: random, but the same for the same seed. */
export function generateProbe(
  index: number,
  options: FuzzOptions,
  attempt = 0,
): Probe {
  const rnd = random(
    seedOf(options.seed, index) ^ Math.imul(attempt, 0x27d4eb2f),
  );
  const pick = <T>(items: readonly T[]): T => items[rnd(items.length)];
  const { fragments, inserts } = fragmentsOf(options.corpus);

  const parts = Array.from({ length: 1 + rnd(3) }, () => pick(fragments));
  let given = parts.join(pick(['\n\n', '\n\n', '\n']));
  if (rnd(3) === 0) {
    given = insertAt(given, rnd(Array.from(given).length + 1), pick(inserts));
  }
  if (rnd(4) !== 0) {
    given += '\n';
  }

  const length = Array.from(given).length;
  const caret = rnd(length + 1);
  const collapsed = rnd(10) < 7;
  const id = `fuzz-${options.seed}-${index}${attempt ? `.${attempt}` : ''}`;
  const base: Probe = {
    id,
    given: '',
    ...(options.properties && { options: { properties: true } }),
  };

  // Undoing what was just done must give the file back byte for byte, so
  // these need no one to say what is right.
  if (collapsed && rnd(4) === 0) {
    const marked = insertAt(given, caret, '‸');
    const plain = pick(['X', 'あ', '𠮷', '1', ' ']);
    const steps: ProbeStep[] =
      rnd(2) === 0
        ? [plain, { kind: 'press', key: 'Backspace' }]
        : [
            { kind: 'press', key: 'Enter' },
            { kind: 'press', key: 'Backspace' },
          ];
    return {
      ...base,
      given: marked,
      steps,
      // Only the file: a caret at the edge of a mark is written outside it.
      expect: given,
      note: 'metamorphic: the steps undo each other',
    };
  }

  let marked = insertAt(given, caret, '‸');
  if (!collapsed) {
    const end = caret + 1 + rnd(Math.max(1, length - caret) + 1);
    marked = insertAt(marked, Math.min(end, length + 1), '‸');
  }
  const steps: ProbeStep[] = [];
  const count = 1 + rnd(options.steps);
  for (let at = 0; at < count; at++) {
    const kind = rnd(20);
    if (kind < 7) {
      steps.push(pick(inserts));
    } else if (kind < 11) {
      steps.push({ kind: 'press', key: pick(KEYS) });
    } else if (kind < 15) {
      steps.push(pick(COMMANDS));
    } else if (kind < 16) {
      steps.push(SELECT_ALL);
    } else if (kind < 17) {
      steps.push({ kind: 'pasteText', text: pick([...inserts, ...fragments]) });
    } else if (kind < 19) {
      steps.push({ kind: 'save' });
    } else {
      steps.push({ kind: 'save' }, { kind: 'reload' });
    }
  }
  return { ...base, given: marked, steps };
}

/**
 * What a verdict is about, without what varies between probes, so the same
 * problem found many times is kept a few times only.
 */
export function groupOf(verdict: Verdict): string {
  const first = verdict.violations[0];
  const detail = (first?.detail ?? '')
    .replace(/\d+/g, 'N')
    .replace(/"[^"]*"/g, '"…"')
    .slice(0, 80);
  return `${verdict.oracles.join('+')} | ${detail}`;
}

/** `90s`, `30m`, `2h` or milliseconds. */
export function parseDuration(text: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(text.trim());
  if (!match) {
    throw new Error(`Cannot read the duration ${JSON.stringify(text)}`);
  }
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[match[2] ?? 'ms'];
  return Number(match[1]) * (unit ?? 1);
}
