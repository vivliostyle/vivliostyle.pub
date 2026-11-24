import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import type { BaseNode } from './base';
import { matchSequences } from './match';
import { type InlineSource, type InlineUnit, RAW_INLINE } from './parse';
import { stripPrefixes } from './source';

/** Content of the textblock, by offset, that is written anew. */
export interface GapPiece {
  from: number;
  to: number;
}

/** Content of the textblock, by offset, written as it was in the source. */
export interface SourceSegment {
  from: number;
  to: number;
  text: string;
}

export type InlinePiece = GapPiece | SourceSegment;

interface Segment {
  from: number;
  to: number;
  baseFrom: number;
  baseTo: number;
  start: number;
  end: number;
  splittable: boolean;
}

// How far a gap grows into reused text at the second try, to let the writer
// escape a character next to the edit whose meaning the edit changed.
const WIDEN = 8;

/** One key per position of a textblock's content, equal for equal content. */
function atomsOf(textblock: ProseMirrorNode, ignoreRaw: boolean): string[] {
  const atoms: string[] = [];
  textblock.forEach((child) => {
    if (child.isText) {
      const marks = JSON.stringify(
        child.marks
          .filter((mark) => !ignoreRaw || mark.type.name !== RAW_INLINE)
          .map((mark) => mark.toJSON()),
      );
      for (const char of child.text ?? '') {
        atoms.push(`${char}\u0001${marks}`);
      }
    } else {
      const key = JSON.stringify(child.toJSON());
      for (let i = 0; i < child.nodeSize; i++) {
        atoms.push(`${key}\u0002${i}`);
      }
    }
  });
  return atoms;
}

/** The marks at each position of a textblock's content, but raw markdown. */
function marksAt(textblock: ProseMirrorNode): string[][] {
  const marks: string[][] = [];
  textblock.forEach((child) => {
    const keys = child.marks
      .filter((mark) => mark.type.name !== RAW_INLINE)
      .map((mark) => JSON.stringify(mark.toJSON()));
    for (let i = 0; i < child.nodeSize; i++) {
      marks.push(keys);
    }
  });
  return marks;
}

/**
 * Units for a textblock whose parser did not record them: its text is
 * matched against its source, and each run of characters found there in
 * order is a unit. What is not found, such as delimiters, belongs to none.
 */
function alignedSource(base: BaseNode): InlineSource | null {
  const { node, text } = base;
  if (text == null || !node.isTextblock) {
    return null;
  }
  const chars: string[] = [];
  node.forEach((child) => {
    if (child.isText) {
      chars.push(...(child.text ?? ''));
    } else {
      for (let i = 0; i < child.nodeSize; i++) {
        chars.push('\u0000');
      }
    }
  });
  if (chars.length !== node.content.size) {
    return null;
  }
  const matches = matchSequences(chars, [...text]);
  const units: InlineUnit[] = [];
  for (let j = 0; j < matches.length; j++) {
    const at = matches[j];
    if (at === -1) {
      continue;
    }
    const last = units.at(-1);
    if (last && last.to === j && last.end === at) {
      last.to++;
      last.end++;
    } else {
      units.push({
        from: j,
        to: j + 1,
        start: at,
        end: at + 1,
        splittable: true,
      });
    }
  }
  return { text, prefixes: [], units };
}

function sharesMark(a: readonly string[], b: readonly string[]): boolean {
  return a.some((mark) => b.includes(mark));
}

/**
 * Splits a textblock into what can be written as its baseline wrote it and
 * what has to be written anew, so an edit changes no more of the source than
 * it has to. `widen` grows what is written anew: 0 is only what changed, 1 a
 * little more around it. Returns `null` when nothing can be reused.
 * `ignoreRaw` matches text whether or not it is raw markdown, for a base
 * read with definitions other than the document's.
 */
export function inlinePieces(
  textblock: ProseMirrorNode,
  base: BaseNode,
  widen: number,
  ignoreRaw = false,
): InlinePiece[] | null {
  if (!base.node.isTextblock) {
    return null;
  }
  const recorded = base.inline?.() ?? null;
  const source = recorded ?? alignedSource(base);
  if (!source || source.units.length === 0) {
    return null;
  }
  const atoms = atomsOf(textblock, ignoreRaw);
  const baseAtoms = atomsOf(base.node, ignoreRaw);
  const matches = matchSequences(atoms, baseAtoms);
  const toNew = new Array<number>(baseAtoms.length).fill(-1);
  matches.forEach((j, i) => {
    if (j !== -1) {
      toNew[j] = i;
    }
  });

  let segments: Segment[] = [];
  for (const unit of source.units) {
    if (unit.splittable) {
      let j = unit.from;
      while (j < unit.to) {
        if (toNew[j] === -1) {
          j++;
          continue;
        }
        let k = j + 1;
        while (k < unit.to && toNew[k] === toNew[k - 1] + 1) {
          k++;
        }
        segments.push({
          from: toNew[j],
          to: toNew[k - 1] + 1,
          baseFrom: j,
          baseTo: k,
          start: unit.start + (j - unit.from),
          end: unit.start + (k - unit.from),
          splittable: true,
        });
        j = k;
      }
    } else {
      let consecutive = toNew[unit.from] !== -1;
      for (let j = unit.from + 1; consecutive && j < unit.to; j++) {
        consecutive = toNew[j] === toNew[j - 1] + 1;
      }
      if (consecutive) {
        segments.push({
          from: toNew[unit.from],
          to: toNew[unit.to - 1] + 1,
          baseFrom: unit.from,
          baseTo: unit.to,
          start: unit.start,
          end: unit.end,
          splittable: false,
        });
      }
    }
  }
  segments.sort((a, b) => a.from - b.from);

  const marks = marksAt(textblock);
  const size = atoms.length;
  // A reused piece must not cut a mark that goes on into what is written
  // anew, nor, where it was found only by its text, start or end inside a
  // mark whose delimiters it would leave behind.
  const cut = (segment: Segment, at: number, neighbour: number) =>
    marks[at].length > 0 &&
    (sharesMark(marks[at], marks[neighbour] ?? []) ||
      (segment.splittable && !recorded));
  const trim = (shrink: number) => {
    let changed = false;
    const next: Segment[] = [];
    segments.forEach((segment, index) => {
      const previous = next.at(-1);
      const gapBefore =
        segment.from > 0 && (!previous || previous.to !== segment.from);
      const following = segments[index + 1];
      const gapAfter =
        segment.to < size && (!following || following.from !== segment.to);
      let { from, to } = segment;
      if (segment.splittable) {
        if (gapBefore) {
          from = Math.min(to, from + shrink);
          while (from < to && cut(segment, from, from - 1)) {
            from++;
          }
        }
        if (gapAfter) {
          to = Math.max(from, to - shrink);
          while (to > from && cut(segment, to - 1, to)) {
            to--;
          }
        }
      } else if (
        (gapBefore && (shrink > 0 || cut(segment, from, from - 1))) ||
        (gapAfter && (shrink > 0 || cut(segment, to - 1, to)))
      ) {
        to = from;
      }
      if (to - from !== segment.to - segment.from) {
        changed = true;
      }
      if (to > from) {
        next.push({
          ...segment,
          from,
          to,
          baseFrom: segment.baseFrom + (from - segment.from),
          baseTo: segment.baseTo - (segment.to - to),
          start: segment.start + (from - segment.from),
          end: segment.end - (segment.to - to),
        });
      }
    });
    segments = next;
    return changed;
  };
  if (widen > 0) {
    trim(WIDEN);
  }
  while (trim(0)) {
    // Trimming one piece can open a gap next to another.
  }
  if (segments.length === 0) {
    return null;
  }

  // Neighbouring pieces of the source go together with what was between
  // them, such as the prefixes of a quote's lines.
  const merged: Segment[] = [];
  for (const segment of segments) {
    const last = merged.at(-1);
    if (
      last &&
      last.to === segment.from &&
      last.baseTo === segment.baseFrom &&
      last.end <= segment.start
    ) {
      last.to = segment.to;
      last.baseTo = segment.baseTo;
      last.end = segment.end;
    } else {
      merged.push({ ...segment });
    }
  }

  if (!recorded) {
    // What the text of a textblock found by its text starts or ends with,
    // such as an escape of a character the old parser dropped, stays with
    // it, up to the end of the line.
    const first = merged[0];
    const last = merged.at(-1);
    if (first?.baseFrom === 0 && first.from === 0 && first.start > 0) {
      const glue = source.text.slice(0, first.start);
      if (!glue.includes('\n')) {
        first.start = 0;
      }
    }
    if (last?.baseTo === baseAtoms.length) {
      const rest = source.text.slice(last.end);
      last.end += rest.match(/^[^\n]*/)?.[0].length ?? 0;
    }
  }

  const pieces: InlinePiece[] = [];
  let at = 0;
  for (const segment of merged) {
    if (segment.from > at) {
      pieces.push({ from: at, to: segment.from });
    }
    pieces.push({
      from: segment.from,
      to: segment.to,
      text: stripPrefixes(
        source.text.slice(segment.start, segment.end),
        source.prefixes,
      ),
    });
    at = segment.to;
  }
  if (at < size) {
    pieces.push({ from: at, to: size });
  }
  return pieces;
}
