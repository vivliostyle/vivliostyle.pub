import { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { describe, expect, it, vi } from 'vitest';

import { documentHtml } from '../../../../testing/html';
import { PubExtensions } from '../../../index';
import { parseMarkdown } from '../../extension';
import {
  MathTypesetCache,
  type MathTypesetter,
  MathTypesetting,
  MathView,
  type TypesetMath,
} from './math-view';

// Stands for the few parts of the DOM a view uses, which Node has none of.
class FakeElement {
  className = '';
  title = '';
  contentEditable = '';
  dataset: Record<string, string> = {};
  children: unknown[] = [];
  text = '';
  constructor(readonly name: string) {}
  set textContent(value: string) {
    this.text = value;
    this.children = [];
  }
  get textContent(): string {
    return this.text;
  }
  replaceChildren(...children: unknown[]): void {
    this.text = '';
    this.children = children;
  }
  cloneNode(): FakeElement {
    const copy = new FakeElement(this.name);
    copy.text = this.text;
    return copy;
  }
}

const fakeDocument = {
  createElement: (name: string) => new FakeElement(name),
} as unknown as Document;

function typesetter(typeset: TypesetMath): {
  typesetter: MathTypesetter;
  load: ReturnType<typeof vi.fn>;
} {
  const load = vi.fn(async () => typeset);
  return { typesetter: { load }, load };
}

/** A cache whose slices run when the test says. */
function manualCache(typesetter: MathTypesetter, sliceMs = 8) {
  const slices: (() => void)[] = [];
  let time = 0;
  const cache = new MathTypesetCache(typesetter, {
    schedule: (run) => slices.push(run),
    now: () => time,
    sliceMs,
  });
  return {
    cache,
    advance: (ms: number) => {
      time += ms;
    },
    /** Lets the engine load, then runs the slices there are. */
    flush: async () => {
      await Promise.resolve();
      await Promise.resolve();
      while (slices.length > 0) {
        slices.shift()?.();
      }
    },
  };
}

const editor = new Editor({
  element: null,
  extensions: [PubExtensions.configure({})],
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
});

function mathOf(markdown: string): ProseMirrorNode {
  let found: ProseMirrorNode | undefined;
  parseMarkdown(editor, markdown).doc.descendants((node) => {
    found ??= node.type.name === 'math' ? node : undefined;
  });
  if (!found) {
    throw new Error(`No math in ${markdown}`);
  }
  return found;
}

const element = (latex: string) => {
  const it = new FakeElement('math');
  it.text = `typeset ${latex}`;
  return it as unknown as Element;
};

describe('typesetting math', () => {
  it('loads the engine only once math is shown', async () => {
    const { typesetter: given, load } = typesetter(element);
    const { cache, flush } = manualCache(given);
    expect(load).not.toHaveBeenCalled();
    cache.request('x', false, () => {});
    cache.request('y', false, () => {});
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('typesets a source once, for every view of it', async () => {
    const typeset = vi.fn(element);
    const { cache, flush } = manualCache(typesetter(typeset).typesetter);
    const first = vi.fn();
    const second = vi.fn();
    expect(cache.request('x^2', false, first).result).toBeNull();
    cache.request('x^2', false, second);
    await flush();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(cache.request('x^2', false, first).result).toEqual({
      element: expect.anything(),
    });
    expect(typeset).toHaveBeenCalledTimes(1);
    cache.request('x^2', true, () => {});
    await flush();
    expect(typeset).toHaveBeenLastCalledWith('x^2', true);
  });

  it('gives the error of LaTeX it cannot typeset', async () => {
    const { cache, flush } = manualCache(
      typesetter(() => {
        throw new Error('Undefined control sequence');
      }).typesetter,
    );
    const done = vi.fn();
    cache.request('\\nope', false, done);
    await flush();
    expect(done).toHaveBeenCalledWith({ error: 'Undefined control sequence' });
  });

  it('typesets many sources a slice at a time', async () => {
    const control = { advance: (_: number) => {} };
    const typeset = vi.fn((latex: string) => {
      control.advance(5);
      return element(latex);
    });
    const slices: (() => void)[] = [];
    let time = 0;
    control.advance = (ms) => {
      time += ms;
    };
    const cache = new MathTypesetCache(typesetter(typeset).typesetter, {
      schedule: (run) => slices.push(run),
      now: () => time,
      sliceMs: 8,
    });
    for (let i = 0; i < 5; i++) {
      cache.request(`x_${i}`, false, () => {});
    }
    await Promise.resolve();
    await Promise.resolve();
    slices.shift()?.();
    expect(typeset).toHaveBeenCalledTimes(2);
    while (slices.length > 0) {
      slices.shift()?.();
    }
    expect(typeset).toHaveBeenCalledTimes(5);
  });

  it('forgets a view that is gone', async () => {
    const { cache, flush } = manualCache(typesetter(element).typesetter);
    const done = vi.fn();
    cache.request('x', false, done).cancel();
    await flush();
    expect(done).not.toHaveBeenCalled();
  });
});

describe('the view of math', () => {
  it('shows the source until math is typeset, then what is typeset', async () => {
    const { cache, flush } = manualCache(typesetter(element).typesetter);
    const view = new MathView(mathOf('a $x^2$ b'), cache, fakeDocument);
    const dom = view.dom as unknown as FakeElement;
    expect(dom.className).toBe('math inline');
    expect(dom.dataset.mathView).toBe('pending');
    expect(dom.textContent).toBe('\\(x^2\\)');
    await flush();
    expect(dom.dataset.mathView).toBe('typeset');
    expect((dom.children[0] as FakeElement).textContent).toBe('typeset x^2');
    expect(dom.title).toBe('\\(x^2\\)');
  });

  it('shows the source of LaTeX with an error as such', async () => {
    const { cache, flush } = manualCache(
      typesetter(() => {
        throw new Error('Missing close brace');
      }).typesetter,
    );
    const view = new MathView(mathOf('$$\\frac{a$$'), cache, fakeDocument);
    await flush();
    const dom = view.dom as unknown as FakeElement;
    expect(dom.className).toBe('math display');
    expect(dom.dataset.mathView).toBe('error');
    expect(dom.textContent).toBe('$$\\frac{a$$');
    expect(dom.title).toBe('Missing close brace');
  });

  it('typesets again only when the source changes', async () => {
    const typeset = vi.fn(element);
    const { cache, flush } = manualCache(typesetter(typeset).typesetter);
    const node = mathOf('$x$');
    const view = new MathView(node, cache, fakeDocument);
    await flush();
    expect(view.update(mathOf('a $x$'))).toBe(true);
    await flush();
    expect(typeset).toHaveBeenCalledTimes(1);
    expect(view.update(mathOf('$y$'))).toBe(true);
    await flush();
    expect(typeset).toHaveBeenCalledTimes(2);
    expect(view.update(editor.schema.text('x'))).toBe(false);
  });
});

describe('the editor with a typesetter', () => {
  const typesetEditor = () =>
    new Editor({
      element: null,
      extensions: [
        PubExtensions.configure({}),
        MathTypesetting.configure({
          typesetter: typesetter(element).typesetter,
        }),
      ],
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    });

  it('keeps the HTML of math, which is what is copied', () => {
    const typesetting = typesetEditor();
    try {
      const markdown = 'a $x^2$ b $$\\sum$$';
      expect(documentHtml(parseMarkdown(typesetting, markdown).doc)).toBe(
        documentHtml(parseMarkdown(editor, markdown).doc),
      );
      const props = typesetting.extensionManager.plugins
        .filter((plugin) => plugin.props.nodeViews?.math)
        .map((plugin) => Object.keys(plugin.props));
      expect(props).toEqual([['nodeViews']]);
    } finally {
      typesetting.destroy();
    }
  });

  it('adds no view without a typesetter', () => {
    const plain = new Editor({
      element: null,
      extensions: [PubExtensions.configure({}), MathTypesetting],
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    try {
      expect(
        plain.extensionManager.plugins.some(
          (plugin) => plugin.props.nodeViews?.math,
        ),
      ).toBe(false);
    } finally {
      plain.destroy();
    }
  });
});
