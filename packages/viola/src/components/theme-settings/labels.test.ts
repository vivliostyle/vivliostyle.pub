import { describe, expect, it } from 'vitest';

import { loadThemeVariableSchema } from '../../libs/theme-variables';
import { findTargetLabel, getTargetLabel, getVariableLabel } from './labels';
import { humanizeKey } from './messages';

describe('humanizeKey', () => {
  it.each([
    ['font-size', 'Font size'],
    ['h7', 'H7'],
    ['', ''],
  ])('%s → %s', (key, label) => {
    expect(humanizeKey(key)).toBe(label);
  });
});

describe('findTargetLabel', () => {
  it('prefers the meaning a module gives a target', () => {
    expect(findTargetLabel('footnote', 'call')).toBe('Note references');
    expect(findTargetLabel('figure', 'call')).toBe('References');
    expect(findTargetLabel('_basic', 'h1')).toBe('<h1>');
    expect(findTargetLabel('section', 'h1')).toBe('<section> containing <h1>');
  });

  it('writes the tags of the HTML elements a target stands for', () => {
    expect(findTargetLabel('_basic', 'bold')).toBe('<b>, <strong>');
    expect(findTargetLabel('_basic', 'heading')).toBe('<h1>–<h6>');
    expect(findTargetLabel('_basic', 'blockquote-p')).toBe(
      '<p> in <blockquote>',
    );
    expect(findTargetLabel('_basic', 'lists')).toBe('<ul>, <ol>, <dl>');
    expect(findTargetLabel('_basic', 'crossref-call')).toBe('Cross-references');
  });

  it('keeps the tags to the targets of the element group', () => {
    expect(findTargetLabel('endnote', 'anchor')).toBe('Note links');
    expect(findTargetLabel('widget', 'p')).toBeUndefined();
  });

  it('falls back to the key', () => {
    expect(findTargetLabel('_basic', 'marquee')).toBeUndefined();
    expect(findTargetLabel('_basic', 'constructor')).toBeUndefined();
    expect(getTargetLabel('_basic', 'marquee')).toBe('Marquee');
  });
});

describe('getVariableLabel', () => {
  it('leaves the target to the heading of its subgroup', () => {
    expect(
      getVariableLabel({
        group: 'page',
        target: 'mbox-top-left',
        propertyKey: 'content',
        subgroup: { kind: 'target', id: 'mbox-top-left' },
      }),
    ).toBe('content');
  });

  it('names a target that its subgroup does not', () => {
    expect(
      getVariableLabel({
        group: '_basic',
        target: 'table-row-even',
        propertyKey: 'background-color',
        subgroup: { kind: 'target', id: 'table' },
      }),
    ).toBe('background-color (Even <tr>)');
    expect(
      getVariableLabel({
        group: 'prism',
        target: 'keyword',
        propertyKey: 'text-color',
        subgroup: { kind: 'category', id: 'color' },
      }),
    ).toBe('text-color (Keywords)');
  });

  it('names where a variable of a folded module comes from', () => {
    expect(
      getVariableLabel({
        group: 'section',
        target: 'h1',
        propertyKey: 'break-before',
        subgroup: { kind: 'target', id: 'h1' },
      }),
    ).toBe('break-before (<section> containing <h1>)');
    expect(
      getVariableLabel({
        group: 'section',
        target: null,
        propertyKey: 'label',
        subgroup: { kind: 'category', id: 'generated-content' },
      }),
    ).toBe('label (Heading numbers and references)');
  });

  it('labels a variable of the group as a whole by its property', () => {
    expect(
      getVariableLabel({
        group: '_meta-properties',
        target: null,
        propertyKey: 'color-foreground-alt',
        subgroup: { kind: 'category', id: 'color' },
      }),
    ).toBe('color-foreground-alt');
  });

  it('tells apart the rows of every subgroup of theme-base', async () => {
    const schema = await loadThemeVariableSchema();
    const duplicates = schema.groups.flatMap((group) =>
      group.subgroups.flatMap((subgroup) => {
        const labels = subgroup.variables.map(getVariableLabel);
        return labels.filter((label, index) => labels.indexOf(label) !== index);
      }),
    );
    expect(duplicates).toEqual([]);
  });

  it('labels every target of theme-base from the vocabulary', async () => {
    const schema = await loadThemeVariableSchema();
    expect(
      schema.variables
        .filter(
          (v) =>
            v.target !== null &&
            findTargetLabel(v.group, v.target) === undefined,
        )
        .map((v) => v.name),
    ).toEqual([]);
  });
});
