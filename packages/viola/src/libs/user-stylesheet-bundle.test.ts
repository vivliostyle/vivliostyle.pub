import { describe, expect, it, vi } from 'vitest';

import {
  bundleUserStylesheets,
  createStylesheetBundleCache,
  INSTALL_FAILURE_TTL_MS,
  type StylesheetRegistry,
} from './user-stylesheet-bundle';

function setup(options: { files?: Record<string, string> } = {}) {
  const installed = new Set<string>();
  const installPackage = vi.fn(async (_specifier: string) => {});
  const registry: StylesheetRegistry = {
    bundleCss: async (source, files) => {
      const key = source.match(/"\.\/(.+)"/)?.[1] ?? '';
      const text = files.get(key) ?? '';
      if (text.includes('bad.css')) {
        throw new Error('File not found: bad.css');
      }
      if (text.includes('THROW')) {
        throw new Error('parse error');
      }
      return `[${text.replace(/\s+/g, ' ').trim()}]`;
    },
    installPackage: async (specifier) => {
      await installPackage(specifier);
      installed.add(specifier.replace(/(?!^)@.*/, ''));
    },
    isPackageInstalled: (name) => installed.has(name),
    isValidPackageName: (name) => /^(@[a-z-]+\/)?[a-z][a-z-]*$/.test(name),
  };
  let clock = 0;
  const cache = createStylesheetBundleCache();
  const context = (isStale = () => false) => ({
    isProjectFile: (path: string) => path in (options.files ?? {}),
    readProjectFile: async (path: string) => options.files?.[path],
    cache,
    isStale,
    registry: async () => registry,
    now: () => clock,
    sleep: async () => {},
  });
  return {
    installPackage,
    installed,
    cache,
    context,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('bundleUserStylesheets', () => {
  it('uses the raw path when nothing is inlinable', async () => {
    const { context } = setup();
    const result = await bundleUserStylesheets(
      [{ path: 'style.css', css: '@import url(https://x.test/a.css); a{}' }],
      context(),
    );
    expect(result).toEqual({ css: undefined });
  });

  it('installs a package once and inlines it ahead of the raw body', async () => {
    const { context, installPackage } = setup();
    const sheets = [
      { path: 'style.css', css: '@import "pkg";\n.a { color: red }' },
    ];
    const result = await bundleUserStylesheets(sheets, context());
    expect(result?.css).toBe('[@import "pkg";]\n\n.a { color: red }');
    expect(result?.error).toBeUndefined();
    await bundleUserStylesheets(sheets, context());
    expect(installPackage).toHaveBeenCalledTimes(1);
  });

  it('keeps imports and the valid body when the body is broken', async () => {
    const { context } = setup();
    const result = await bundleUserStylesheets(
      [{ path: 'style.css', css: '@import "pkg";\n.{color:red} } .ok{a:b}' }],
      context(),
    );
    expect(result?.css).toContain('[@import "pkg";]');
    expect(result?.css).toContain('.ok{a:b}');
    expect(result?.error).toBeUndefined();
  });

  it('applies the imports that work when one fails', async () => {
    const { context } = setup({ files: { 'bad.css': '' } });
    const result = await bundleUserStylesheets(
      [
        {
          path: 'style.css',
          css: '@import "pkg";\n@import "./bad.css";\n.a{}',
        },
      ],
      context(),
    );
    expect(result?.css).toContain('[@import "pkg";]');
    expect(result?.css).toContain('.a{}');
  });

  it('reports a bad import without dropping the sheet', async () => {
    const { context } = setup({ files: { 'bad.css': 'x' } });
    const result = await bundleUserStylesheets(
      [{ path: 'style.css', css: '@import "bad.css";\n.a{}' }],
      context(),
    );
    expect(result?.css).toContain('.a{}');
    expect(result?.error).toMatchObject({ kind: 'import', target: 'bad.css' });
  });

  it('shares an in-flight install between concurrent runs', async () => {
    const { context, installPackage, installed } = setup();
    let release: () => void = () => {};
    installPackage.mockImplementation(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const sheets = [{ path: 'style.css', css: '@import "pkg";' }];
    const first = bundleUserStylesheets(sheets, context());
    const second = bundleUserStylesheets(sheets, context());
    await vi.waitFor(() => expect(installPackage).toHaveBeenCalled());
    installed.add('pkg');
    release();
    await Promise.all([first, second]);
    expect(installPackage).toHaveBeenCalledTimes(1);
  });

  it('retries a failed install only after the failure expires', async () => {
    const { context, installPackage, advance } = setup();
    installPackage.mockRejectedValueOnce(new Error('Failed to fetch'));
    const sheets = [{ path: 'style.css', css: '@import "pkg";' }];
    const first = await bundleUserStylesheets(sheets, context());
    expect(first?.error).toMatchObject({ kind: 'import', target: 'pkg' });
    await bundleUserStylesheets(sheets, context());
    expect(installPackage).toHaveBeenCalledTimes(1);
    advance(INSTALL_FAILURE_TTL_MS + 1);
    const third = await bundleUserStylesheets(sheets, context());
    expect(installPackage).toHaveBeenCalledTimes(2);
    expect(third?.error).toBeUndefined();
  });

  it('does not install invalid package names', async () => {
    const { context, installPackage } = setup();
    const result = await bundleUserStylesheets(
      [{ path: 'style.css', css: '@import "FOO";' }],
      context(),
    );
    expect(installPackage).not.toHaveBeenCalled();
    expect(result?.error).toMatchObject({ kind: 'import', target: 'FOO' });
  });

  it('discards a run that went stale', async () => {
    const { context, installPackage } = setup();
    let stale = false;
    const ctx = {
      ...context(() => stale),
      sleep: async () => {
        stale = true;
      },
    };
    const result = await bundleUserStylesheets(
      [{ path: 'style.css', css: '@import "pkg";' }],
      ctx,
    );
    expect(result).toBeUndefined();
    expect(installPackage).not.toHaveBeenCalled();
  });
});
