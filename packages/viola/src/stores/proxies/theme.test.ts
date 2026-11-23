import { proxy, ref, subscribe, unstable_enableOp } from 'valtio';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SandboxFile } from '../../libs/sandbox/file';
import type { Project } from './project';
import type { Sandbox } from './sandbox';
import { Theme } from './theme';

async function setup(css = ':root {}') {
  const files = proxy<Sandbox['files']>({
    'style.css': ref(new SandboxFile('text/css', css)),
  });
  const sandbox = {
    files,
    vivliostyleConfig: { theme: ['@vivliostyle/theme-base', 'style.css'] },
  } as unknown as Sandbox;
  const theme = Theme.create({ sandbox } as unknown as Project);
  await theme.loadStylesheets(sandbox);
  const writes: string[] = [];
  subscribe(files, (ops) => {
    for (const op of ops) {
      if (op[2] instanceof SandboxFile) {
        writes.push(op[1][0] as string);
      }
    }
  });
  const fileText = () => files['style.css'].text();
  // valtio delivers subscriptions on a microtask
  const settle = () => Promise.resolve();
  return { theme, files, writes, fileText, settle };
}

describe('Theme stylesheet edits', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    unstable_enableOp();
  });
  afterEach(() => {
    vi.useRealTimers();
    unstable_enableOp(false);
  });

  it('applies a commit and writes it at once', async () => {
    const { theme, fileText } = await setup();
    theme.updateStylesheet('style.css', ':root { --a: 1 }');
    expect(theme.stylesheets[0].css).toBe(':root { --a: 1 }');
    expect(theme.bundledStylesheetCss).toBeUndefined();
    expect(await fileText()).toBe(':root { --a: 1 }');
  });

  it('writes a burst of commits once more, with the latest css', async () => {
    const { theme, writes, fileText, settle } = await setup();
    theme.updateStylesheet('style.css', 'a');
    await settle();
    for (const css of ['b', 'c', 'd']) {
      vi.advanceTimersByTime(30);
      theme.updateStylesheet('style.css', css);
      expect(theme.stylesheets[0].css).toBe(css);
    }
    expect(await fileText()).toBe('a');
    vi.advanceTimersByTime(200);
    await settle();
    expect(await fileText()).toBe('d');
    expect(writes).toEqual(['style.css', 'style.css']);
  });

  it('waits for a pause in typing', async () => {
    const { theme, fileText } = await setup('x');
    theme.updateStylesheet('style.css', 'xy', { debounce: true });
    vi.advanceTimersByTime(200);
    theme.updateStylesheet('style.css', 'xyz', { debounce: true });
    vi.advanceTimersByTime(299);
    expect(theme.stylesheets[0].css).toBe('x');
    vi.advanceTimersByTime(1);
    expect(theme.stylesheets[0].css).toBe('xyz');
    expect(await fileText()).toBe('xyz');
  });

  it('lets a commit supersede typing that is still waiting', async () => {
    const { theme } = await setup('x');
    theme.updateStylesheet('style.css', 'typed', { debounce: true });
    theme.updateStylesheet('style.css', 'committed');
    vi.advanceTimersByTime(1000);
    expect(theme.stylesheets[0].css).toBe('committed');
  });

  it('flushes waiting edits and writes', async () => {
    const { theme, fileText } = await setup();
    theme.updateStylesheet('style.css', 'a');
    theme.updateStylesheet('style.css', 'b');
    theme.updateStylesheet('style.css', 'c', { debounce: true });
    theme.flushStylesheetEdits();
    expect(theme.stylesheets[0].css).toBe('c');
    expect(await fileText()).toBe('c');
  });

  it('does not write css that is already in the file', async () => {
    const { theme, writes, settle } = await setup('same');
    theme.updateStylesheet('style.css', 'same');
    await settle();
    expect(writes).toEqual([]);
    theme.updateStylesheet('style.css', 'other');
    theme.updateStylesheet('style.css', 'next');
    theme.updateStylesheet('style.css', 'other');
    vi.advanceTimersByTime(1000);
    await settle();
    expect(writes).toEqual(['style.css']);
  });
});
