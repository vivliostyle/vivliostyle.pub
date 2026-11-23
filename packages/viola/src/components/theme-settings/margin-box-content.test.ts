import { describe, expect, it } from 'vitest';

import { parseThemeCss } from '../../libs/theme-variables';
import {
  getPageContent,
  getWritingMode,
  previewContent,
} from './margin-box-content';
import { findCell, type MarginBoxCell } from './margin-boxes';

const samples = { page: 12, pages: 200 };

describe('previewContent', () => {
  it.each([
    ['counter(page)', '12'],
    ['counter(pages)', '200'],
    ['"- " counter(page) " -"', '- 12 -'],
    ["counter(page, lower-roman) ' / ' counter(pages)", '12 / 200'],
    ['env(pub-title)', 'Book Title'],
    ['env(doc-title)', 'Document Title'],
    ['"\\201C" string(chapter) "\\201D"', '“string(chapter)”'],
  ])('%s → %s', (value, preview) => {
    expect(previewContent(value, samples)).toBe(preview);
  });

  it.each([
    [undefined],
    ["''"],
    ['""'],
    ['none'],
    ['normal'],
    ['"  "'],
  ])('shows nothing for %s', (value) => {
    expect(previewContent(value, samples)).toBeNull();
  });
});

describe('getPageContent', () => {
  const cell = (id: string) => findCell(id) as MarginBoxCell;
  const model = parseThemeCss(`
    :root {
      --vs-page--mbox-top-center-content: env(pub-title);
      --vs-page--mbox-top-left-content: '';
    }
    @page :left {
      --vs-page--mbox-bottom-left-content: counter(page);
    }
  `);
  const defaults: Record<string, string> = {
    '--vs-page--mbox-bottom-outside-content': 'counter(page)',
    '--vs-page--mbox-top-outside-content': 'env(doc-title)',
  };
  const content = (id: string, side: 'left' | 'right') =>
    getPageContent(
      cell(id),
      { side, first: false },
      model,
      (_, name) => defaults[name],
    );

  it('takes the value a stylesheet scope reaching the page sets', () => {
    expect(content('mbox-top-center', 'left')).toBe('env(pub-title)');
    expect(content('mbox-top-center', 'right')).toBe('env(pub-title)');
    expect(content('mbox-bottom-left', 'left')).toBe('counter(page)');
  });

  it('falls back to the outside or inside of the spread', () => {
    expect(content('mbox-bottom-right', 'right')).toBe('counter(page)');
    expect(content('mbox-bottom-right', 'left')).toBeUndefined();
    expect(content('mbox-bottom-left', 'right')).toBeUndefined();
  });

  it('keeps a value of its own, even an empty one, over the fallback', () => {
    expect(content('mbox-top-left', 'left')).toBe("''");
    expect(content('mbox-top-right', 'right')).toBe('env(doc-title)');
  });

  it('reads the first page as a right page that `:first` rules override', () => {
    const first = parseThemeCss(`
      @page :right {
        --vs-page--mbox-top-right-content: env(doc-title);
        --vs-page--mbox-bottom-right-content: counter(page);
      }
      @page :first {
        --vs-page--mbox-top-right-content: '';
      }
    `);
    const onFirst = (id: string) =>
      getPageContent(
        cell(id),
        { side: 'right', first: true },
        first,
        () => undefined,
      );
    expect(onFirst('mbox-top-right')).toBe("''");
    expect(onFirst('mbox-bottom-right')).toBe('counter(page)');
    expect(
      getPageContent(
        cell('mbox-bottom-right'),
        { side: 'right', first: true },
        model,
        (_, name) =>
          name === '--vs-page--mbox-bottom-outside-content' ? '1' : undefined,
      ),
    ).toBe('1');
  });

  it('reads a first page on the left with `:left` rules and its outside', () => {
    const first = parseThemeCss(`
      @page :left {
        --vs-page--mbox-top-left-content: env(doc-title);
      }
    `);
    const page = { side: 'left', first: true } as const;
    const classes: (readonly string[])[] = [];
    expect(
      getPageContent(cell('mbox-top-left'), page, first, (pageClasses) => {
        classes.push(pageClasses);
        return undefined;
      }),
    ).toBe('env(doc-title)');
    expect(
      getPageContent(
        cell('mbox-bottom-left'),
        page,
        first,
        (pageClasses, name) => {
          classes.push(pageClasses);
          return name === '--vs-page--mbox-bottom-outside-content'
            ? '1'
            : undefined;
        },
      ),
    ).toBe('1');
    expect(classes).toContainEqual(['first', 'left']);
  });
});

describe('getWritingMode', () => {
  const mode = (css: string, fallback?: string) =>
    getWritingMode(parseThemeCss(css), () => fallback);

  it('takes a sideways mode for the vertical one of its side', () => {
    expect(mode(':root{--vs-writing-mode:vertical-rl}')).toBe('vertical-rl');
    expect(mode(':root{--vs-writing-mode:sideways-rl}')).toBe('vertical-rl');
    expect(mode(':root{--vs-writing-mode:Vertical-LR}')).toBe('vertical-lr');
    expect(mode('', 'vertical-rl')).toBe('vertical-rl');
    expect(mode('')).toBe('horizontal-tb');
  });

  it('prefers what the stylesheet sets for print to the theme', () => {
    expect(
      mode(
        ':root{--vs-writing-mode:vertical-rl}@media print{:root{--vs-writing-mode:horizontal-tb}}',
      ),
    ).toBe('horizontal-tb');
    expect(mode(':root{--vs-writing-mode:horizontal-tb}', 'vertical-rl')).toBe(
      'horizontal-tb',
    );
  });
});
