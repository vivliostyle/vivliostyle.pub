import { describe, expect, it } from 'vitest';

import { classifyCssImport, extractCssImportSpecifiers } from './css-imports';

describe('extractCssImportSpecifiers', () => {
  it('reads string and url() forms with conditions', () => {
    expect(
      extractCssImportSpecifiers(`
        @import "a.css";
        @import 'b.css' layer(x) screen;
        @import url("c.css") supports(display: grid);
        @import url('d.css');
        @import url( e.css );
        @IMPORT "f.css";
        @import url(https://example.com/g.css);
      `),
    ).toEqual([
      'a.css',
      'b.css',
      'c.css',
      'd.css',
      'e.css',
      'f.css',
      'https://example.com/g.css',
    ]);
  });

  it('ignores imports in comments, strings and nested blocks', () => {
    expect(
      extractCssImportSpecifiers(`
        /* @import "commented.css"; */
        .a::before { content: "@import 'str.css';"; }
        @media print { @import "nested.css"; }
        @import /* c */ "real.css";
        .b { content: '@import "x"' }
        @important { }
      `),
    ).toEqual(['real.css']);
  });

  it('survives broken CSS', () => {
    expect(extractCssImportSpecifiers('@import "a.css')).toEqual(['a.css']);
    expect(extractCssImportSpecifiers('@import url(')).toEqual([]);
    expect(extractCssImportSpecifiers('@import ;} } @import "b.css";')).toEqual(
      ['b.css'],
    );
    expect(extractCssImportSpecifiers('/* unterminated @import "a"')).toEqual(
      [],
    );
    expect(extractCssImportSpecifiers('')).toEqual([]);
  });
});

describe('classifyCssImport', () => {
  const none = () => false;

  it('classifies URLs as external', () => {
    expect(
      classifyCssImport('https://x.test/a.css', 'style.css', none),
    ).toEqual({ kind: 'external', specifier: 'https://x.test/a.css' });
    expect(classifyCssImport('//x.test/a.css', 'style.css', none)?.kind).toBe(
      'external',
    );
  });

  it('resolves relative files against the importer', () => {
    expect(classifyCssImport('./other.css', 'style.css', none)).toMatchObject({
      kind: 'file',
      path: 'other.css',
    });
    expect(classifyCssImport('../b.css?x=1', 'css/a.css', none)).toMatchObject({
      kind: 'file',
      path: 'b.css',
    });
    expect(classifyCssImport('../../b.css', 'css/a.css', none)).toBeUndefined();
  });

  it('treats a bare specifier naming a project file as a file', () => {
    expect(
      classifyCssImport('other.css', 'style.css', (p) => p === 'other.css'),
    ).toMatchObject({ kind: 'file', path: 'other.css' });
    expect(classifyCssImport('other.css', 'style.css', none)?.kind).toBe(
      'package',
    );
  });

  it('extracts the package from bare specifiers', () => {
    expect(
      classifyCssImport('@vivliostyle/theme-techbook', 's.css', none),
    ).toMatchObject({
      kind: 'package',
      packageName: '@vivliostyle/theme-techbook',
      installSpecifier: '@vivliostyle/theme-techbook',
    });
    expect(
      classifyCssImport('@vivliostyle/theme-base@3.1.0/figure', 's.css', none),
    ).toMatchObject({
      packageName: '@vivliostyle/theme-base',
      installSpecifier: '@vivliostyle/theme-base@3.1.0',
    });
    expect(classifyCssImport('pkg/sub/path.css', 's.css', none)).toMatchObject({
      packageName: 'pkg',
      installSpecifier: 'pkg',
    });
    expect(classifyCssImport('', 's.css', none)).toBeUndefined();
  });
});
