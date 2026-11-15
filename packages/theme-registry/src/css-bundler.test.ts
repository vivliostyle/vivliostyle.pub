import type { TarLocalFile } from '@andrewbranch/untar.js';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  bundleCss,
  locateDefaultThemeFile,
  locateThemeFileFromImportPath,
  resolvePackageExports,
} from './css-bundler';
import { fetchPackageContent } from './index';
import {
  contentCache,
  directorySourceMap,
  fileMap,
  mountPackageContent,
  type RegistryUrl,
} from './store';
import type { IdealTree, PackageJson } from './type';

// Key order as served by registry.npmjs.org, where `./*` precedes the exact keys
const themeBase: PackageJson = {
  name: '@vivliostyle/theme-base',
  version: '3.1.0',
  main: 'theme.css',
  vivliostyle: { theme: { style: 'theme.css' } },
  exports: {
    '.': './theme.css',
    './*': './css/*.css',
    './toc': './css/toc/index.css',
    './prism': './css/prism/index.css',
    './figure': './css/figure/index.css',
    './appendix': './css/appendix/index.css',
    './footnote': './css/footnote/index.css',
    './package.json': './package.json',
  },
};
const themeBaseFiles = [
  'package.json',
  'theme.css',
  'css/reset.css',
  'css/define.css',
  'css/basic.css',
  'css/toc/index.css',
  'css/appendix/index.css',
  'css/figure/index.css',
  'css/footnote/index.css',
  'css/footnote/external-links.css',
  'css/prism/index.css',
  'css/prism/theme-okaidia.css',
];

const locate = (
  packageJson: PackageJson,
  importPath: string,
  fileList = themeBaseFiles,
) => locateThemeFileFromImportPath({ packageJson, importPath, fileList });

const pkg = (fields: Partial<PackageJson>): PackageJson => ({
  name: 'pkg',
  version: '1.0.0',
  ...fields,
});

describe('resolvePackageExports', () => {
  it('matches exact keys with the ./ prefix', () => {
    expect(resolvePackageExports(themeBase, './appendix')).toBe(
      './css/appendix/index.css',
    );
    expect(resolvePackageExports(themeBase, '.')).toBe('./theme.css');
  });

  it('expands subpath patterns', () => {
    expect(resolvePackageExports(themeBase, './prism/theme-okaidia')).toBe(
      './css/prism/theme-okaidia.css',
    );
    expect(resolvePackageExports(themeBase, './define')).toBe(
      './css/define.css',
    );
  });

  it('prefers the most specific match', () => {
    const exports = {
      './*': './a/*.css',
      './x/*': './b/*.css',
      './x/*.css': './c/*.css',
      './x/y': './exact.css',
    };
    const p = pkg({ exports });
    expect(resolvePackageExports(p, './x/y')).toBe('./exact.css');
    expect(resolvePackageExports(p, './x/z')).toBe('./b/z.css');
    expect(resolvePackageExports(p, './x/z.css')).toBe('./c/z.css');
    expect(resolvePackageExports(p, './z')).toBe('./a/z.css');
  });

  it('replaces every * in the target', () => {
    const p = pkg({ exports: { './*': './*/*.css' } });
    expect(resolvePackageExports(p, './a')).toBe('./a/a.css');
  });

  it('requires a non-empty pattern match', () => {
    const p = pkg({ exports: { './x/*': './x/*.css' } });
    expect(() => resolvePackageExports(p, './x/')).toThrow(
      'does not export the path ./x/',
    );
  });

  it('treats a string or condition object as the root export', () => {
    expect(resolvePackageExports(pkg({ exports: './a.css' }), '.')).toBe(
      './a.css',
    );
    expect(
      resolvePackageExports(
        pkg({ exports: { style: './a.css', default: './a.js' } }),
        '.',
      ),
    ).toBe('./a.css');
    expect(() =>
      resolvePackageExports(pkg({ exports: './a.css' }), './a'),
    ).toThrow('does not export the path ./a');
  });

  it('picks the first matching condition in key order', () => {
    const p = pkg({
      exports: {
        './a': { import: './a.mjs', style: './a.css', default: './a.txt' },
        './b': { require: './b.cjs', default: './b.css' },
        './c': {
          browser: { style: './c1.css' },
          style: { default: './c2.css' },
        },
        './d': { style: { import: './d.mjs' }, default: './d.css' },
        './e': [{ import: './e.mjs' }, './e.css'],
      },
    });
    expect(resolvePackageExports(p, './a')).toBe('./a.css');
    expect(resolvePackageExports(p, './b')).toBe('./b.css');
    expect(resolvePackageExports(p, './c')).toBe('./c2.css');
    expect(resolvePackageExports(p, './d')).toBe('./d.css');
    expect(resolvePackageExports(p, './e')).toBe('./e.css');
  });

  it('honors null targets as exclusions', () => {
    const p = pkg({ exports: { './*': './*.css', './private/*': null } });
    expect(() => resolvePackageExports(p, './private/a')).toThrow(
      'does not export the path ./private/a',
    );
    expect(resolvePackageExports(p, './public')).toBe('./public.css');
  });

  it('rejects invalid exports', () => {
    expect(() =>
      resolvePackageExports(
        pkg({ exports: { '.': './a.css', style: './b.css' } }),
        '.',
      ),
    ).toThrow('invalid exports field');
    expect(() =>
      resolvePackageExports(pkg({ exports: { '.': '../a.css' } }), '.'),
    ).toThrow('does not export the path .');
  });

  it('returns undefined without an exports field', () => {
    expect(resolvePackageExports(pkg({}), './a')).toBeUndefined();
  });
});

describe('locateDefaultThemeFile', () => {
  it('accepts the entries the bundler resolves', () => {
    expect(locateDefaultThemeFile({ packageJson: themeBase })).toBe(
      'theme.css',
    );
    expect(
      locateDefaultThemeFile({
        packageJson: pkg({
          main: 'index.js',
          exports: { '.': { style: './dist/a.css', default: './index.js' } },
        }),
      }),
    ).toBe('./dist/a.css');
  });

  it('rejects packages without a style entry', () => {
    expect(() =>
      locateDefaultThemeFile({
        packageJson: pkg({ main: 'index.js', exports: './index.js' }),
      }),
    ).toThrow('Could not find a style file');
  });
});

describe('locateThemeFileFromImportPath', () => {
  it('resolves subpaths of theme-base v3', () => {
    expect(locate(themeBase, 'appendix')).toBe('css/appendix/index.css');
    expect(locate(themeBase, 'prism')).toBe('css/prism/index.css');
    expect(locate(themeBase, 'prism/theme-okaidia')).toBe(
      'css/prism/theme-okaidia.css',
    );
    expect(locate(themeBase, 'footnote/external-links')).toBe(
      'css/footnote/external-links.css',
    );
    expect(locate(themeBase, 'basic')).toBe('css/basic.css');
  });

  it('rejects exported paths that do not exist', () => {
    expect(() => locate(themeBase, 'missing')).toThrow(
      'The exported path ./missing does not exist',
    );
  });

  it('rejects paths escaping the package', () => {
    expect(() => locate(themeBase, '../../theme.css')).toThrow(
      'escapes the package directory',
    );
    expect(() =>
      locate(pkg({ exports: { './*': './../*.css' } }), 'b', ['b.css']),
    ).toThrow('The exported path ./b does not exist');
  });

  it('resolves the package entry', () => {
    expect(locate(themeBase, '')).toBe('theme.css');
    expect(
      locate(
        pkg({
          vivliostyle: { theme: { style: './theme.css' } },
          exports: { '.': './other.css' },
        }),
        '',
        ['theme.css', 'other.css'],
      ),
    ).toBe('theme.css');
    expect(
      locate(
        pkg({
          main: 'index.js',
          exports: { '.': { style: './dist/a.css', default: './index.js' } },
        }),
        '',
        ['index.js', 'dist/a.css'],
      ),
    ).toBe('dist/a.css');
    expect(
      locate(pkg({ main: './theme.css' }), '', ['index.js', 'theme.css']),
    ).toBe('theme.css');
  });

  it('rejects an entry without a style file', () => {
    expect(() => locate(pkg({ main: 'index.js' }), '', ['index.js'])).toThrow(
      'Could not find a style file',
    );
    expect(() =>
      locate(pkg({ style: 'missing.css' }), '', ['theme.css']),
    ).toThrow('The declared style file does not exist');
  });

  it('resolves subpaths as files without an exports field', () => {
    const legacy = pkg({ style: 'theme.css' });
    const files = ['theme.css', 'css/extra.css'];
    expect(locate(legacy, 'css/extra.css', files)).toBe('css/extra.css');
    expect(locate(legacy, './css/extra.css', files)).toBe('css/extra.css');
    expect(() => locate(legacy, 'css/extra', files)).toThrow(
      'does not have a style file for the import path css/extra',
    );
  });
});

const encoder = new TextEncoder();

function mount(
  pkgPath: string,
  packageJson: PackageJson,
  files: Record<string, string>,
) {
  const source =
    `https://registry.npmjs.org/${packageJson.name}/-/${packageJson.version}.tgz` as RegistryUrl;
  mountPackageContent(
    pkgPath,
    source,
    Object.entries({
      ...files,
      'package.json': JSON.stringify(packageJson),
    }).map(
      ([name, content]) =>
        ({ name, fileData: encoder.encode(content) }) as TarLocalFile,
    ),
  );
  return source;
}

beforeEach(() => {
  contentCache.clear();
  directorySourceMap.clear();
  fileMap.clear();
});

describe('bundleCss', () => {
  const techbook = pkg({
    name: '@vivliostyle/theme-techbook',
    main: 'theme.css',
    vivliostyle: { theme: { style: 'theme.css' } },
  });
  const techbookCss = `
    @import '@vivliostyle/theme-base';
    @import '@vivliostyle/theme-base/figure';
    @import "@vivliostyle/theme-base/prism/theme-okaidia";
    @import url('https://fonts.googleapis.com/css?family=Source+Code+Pro');
    .techbook { color: red; }
  `;
  const themeBaseCss = {
    'theme.css': '@import url(css/reset.css);\n@import url(css/define.css);',
    'css/reset.css': '.reset { margin: 0 }',
    'css/define.css': ':root { --vs-color-foreground: #000; }',
    'css/figure/index.css': 'figure { & figcaption { color: blue } }',
    'css/prism/theme-okaidia.css': '.token.comment { color: gray }',
  };

  const bundle = async (source: string) =>
    new TextDecoder().decode((await bundleCss(source)).code);

  it('bundles a theme importing theme-base subpaths', async () => {
    mount('node_modules/@vivliostyle/theme-base', themeBase, themeBaseCss);
    mount('node_modules/@vivliostyle/theme-techbook', techbook, {
      'theme.css': techbookCss,
    });

    const css = await bundle('@import "@vivliostyle/theme-techbook";');
    expect(css).toContain('.reset{margin:0}');
    expect(css).toContain('--vs-color-foreground:#000');
    expect(css).toContain('figure{& figcaption{color:#00f}}');
    expect(css).toContain('.token.comment{color:gray}');
    expect(css).toContain('.techbook{color:red}');
    expect(css).toContain(
      '@import "https://fonts.googleapis.com/css?family=Source+Code+Pro"',
    );
    expect(css).not.toContain('@vivliostyle/theme-base');
  });

  it('bundles virtual files that import packages and each other', async () => {
    mount('node_modules/@vivliostyle/theme-base', themeBase, themeBaseCss);
    const files = new Map([
      [
        'project/style.css',
        '@import "@vivliostyle/theme-base/figure" layer(base);\n@import "./sub/a.css";\n.mine { color: red }',
      ],
      ['project/sub/a.css', '@import "../b.css";\n.a { color: blue }'],
      ['project/b.css', '.b { margin: 0 }'],
    ]);

    const code = (await bundleCss('@import "./project/style.css";', files))
      .code;
    const css = new TextDecoder().decode(code);
    expect(css).toContain('.b{margin:0}');
    expect(css).toContain('.a{color:#00f}');
    expect(css).toContain('.mine{color:red}');
    expect(css).toContain('@layer base');
    expect(css).toContain('figcaption');
  });

  it('reports a missing virtual import', async () => {
    const files = new Map([['project/style.css', '@import "./nope.css";']]);
    await expect(
      bundleCss('@import "./project/style.css";', files),
    ).rejects.toThrow(/File not found/);
  });

  it('prefers a nested dependency over the hoisted one', async () => {
    mount('node_modules/@vivliostyle/theme-base', themeBase, {
      ...themeBaseCss,
      'css/define.css': '.hoisted { color: red }',
    });
    mount('node_modules/@vivliostyle/theme-techbook', techbook, {
      'theme.css': "@import '@vivliostyle/theme-base';",
    });
    mount(
      'node_modules/@vivliostyle/theme-techbook/node_modules/@vivliostyle/theme-base',
      { ...themeBase, version: '3.1.1' },
      { ...themeBaseCss, 'css/define.css': '.nested { color: red }' },
    );

    expect(await bundle('@import "@vivliostyle/theme-techbook";')).toContain(
      '.nested{color:red}',
    );
    expect(await bundle('@import "@vivliostyle/theme-base";')).toContain(
      '.hoisted{color:red}',
    );
  });

  it('reports a missing package', async () => {
    mount('node_modules/@vivliostyle/theme-techbook', techbook, {
      'theme.css': "@import '@vivliostyle/theme-base';",
    });
    await expect(
      bundle('@import "@vivliostyle/theme-techbook";'),
    ).rejects.toThrow('Package @vivliostyle/theme-base not found');
  });
});

describe('fetchPackageContent', () => {
  const treeOf = (packageJson: PackageJson, tarball: string): IdealTree => ({
    [packageJson.name]: {
      ...packageJson,
      dist: {
        fileCount: 0,
        integrity: '',
        shasum: '',
        signatures: [],
        tarball,
        unpackedSize: 0,
      },
      dependencies: {},
    },
  });

  it('mounts a cached tarball at the requested path', async () => {
    const v1 = pkg({ version: '1.0.0' });
    const source = mount('node_modules/other/node_modules/pkg', v1, {
      'theme.css': '',
    });

    await fetchPackageContent(treeOf(v1, source));
    expect(fileMap.has('node_modules/pkg/theme.css')).toBe(true);
  });

  it('drops files of the previously mounted version', async () => {
    const v2 = pkg({ version: '2.0.0' });
    const v2Source = mount('node_modules/other/node_modules/pkg', v2, {
      'theme.css': '',
    });
    mount('node_modules/pkg', pkg({ version: '1.0.0' }), {
      'theme.css': '',
      'removed.css': '',
    });

    await fetchPackageContent(treeOf(v2, v2Source));
    expect(fileMap.has('node_modules/pkg/theme.css')).toBe(true);
    expect(fileMap.has('node_modules/pkg/removed.css')).toBe(false);
  });
});
