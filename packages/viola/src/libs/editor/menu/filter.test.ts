import { describe, expect, it } from 'vitest';

import { flattenCommands } from './config';
import { filterMenuEntries, matchesQuery } from './filter';
import type { EditorMenuCommand, ResolvedMenuEntry } from './types';

const heading: EditorMenuCommand = {
  id: 'block.heading-1',
  surfaces: ['trigger'],
  label: () => '見出し1',
  keywords: () => ['みだし', 'heading', 'h1', '#'],
};
const quote: EditorMenuCommand = {
  id: 'block.blockquote',
  surfaces: ['trigger'],
  label: () => 'Quote',
  keywords: () => ['>'],
};
const image: EditorMenuCommand = {
  id: 'insert.image',
  surfaces: ['trigger'],
  label: () => 'Insert Image',
};

const entries: ResolvedMenuEntry[] = [
  { type: 'group', id: 'basic', label: () => 'Basic', commands: [heading] },
  { type: 'separator' },
  { type: 'group', id: 'list', label: () => 'List', commands: [quote] },
  { type: 'command', command: image },
];

describe('matchesQuery', () => {
  it('matches every command for an empty query', () => {
    expect(matchesQuery(image, '')).toBe(true);
  });

  it('matches labels and keywords case-insensitively', () => {
    expect(matchesQuery(image, 'image')).toBe(true);
    expect(matchesQuery(image, 'IMA')).toBe(true);
    expect(matchesQuery(heading, '見出し')).toBe(true);
    expect(matchesQuery(heading, 'みだ')).toBe(true);
    expect(matchesQuery(quote, '>')).toBe(true);
    expect(matchesQuery(heading, 'quote')).toBe(false);
  });

  it('folds full-width input from an IME', () => {
    expect(matchesQuery(heading, 'ｈ１')).toBe(true);
    expect(matchesQuery(image, 'ＩＭＡＧＥ')).toBe(true);
    expect(matchesQuery(heading, '＃')).toBe(true);
  });
});

describe('filterMenuEntries', () => {
  it('returns every entry for an empty query', () => {
    expect(filterMenuEntries(entries, '')).toEqual(entries);
  });

  it('keeps config order and drops empty groups with their separators', () => {
    const filtered = filterMenuEntries(entries, 'h1');
    expect(filtered.map((entry) => entry.type)).toEqual(['group']);
    expect(flattenCommands(filtered)).toEqual([heading]);
  });

  it('keeps separators between remaining entries', () => {
    const filtered = filterMenuEntries(entries, 'e');
    expect(filtered.map((entry) => entry.type)).toEqual([
      'group',
      'separator',
      'group',
      'command',
    ]);
    expect(flattenCommands(filtered)).toEqual([heading, quote, image]);
  });

  it('drops a separator left at the edge', () => {
    const filtered = filterMenuEntries(entries, 'quo');
    expect(filtered.map((entry) => entry.type)).toEqual(['group']);
  });

  it('returns nothing when no command matches', () => {
    expect(filterMenuEntries(entries, 'zzz')).toEqual([]);
  });
});
