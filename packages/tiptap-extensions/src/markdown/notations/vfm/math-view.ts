import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { NodeView } from '@tiptap/pm/view';

/** Typesets LaTeX as an element. Throws when the LaTeX has an error. */
export type TypesetMath = (latex: string, display: boolean) => Element;

/** Gives the editor a typesetter, which is loaded once math is shown. */
export interface MathTypesetter {
  load(): Promise<TypesetMath>;
}

export type TypesetResult = { element: Element } | { error: string };

export interface MathTypesetCacheOptions {
  /** Runs a slice of typesetting later. */
  schedule?: (run: () => void) => void;
  now?: () => number;
  /** How long a slice may typeset before the editor takes input again. */
  sliceMs?: number;
  size?: number;
}

/**
 * Typesets each source once and keeps the result for every view of it: a
 * remote change or a keystroke elsewhere only makes views of sources typeset
 * before. New sources are typeset in slices, so a document of many does not
 * hold up input.
 */
export class MathTypesetCache {
  private typeset: TypesetMath | null = null;
  private loadStarted = false;
  private readonly results = new Map<string, TypesetResult>();
  private readonly waiting = new Map<
    string,
    Set<(result: TypesetResult) => void>
  >();
  private scheduled = false;
  private readonly schedule: (run: () => void) => void;
  private readonly now: () => number;
  private readonly sliceMs: number;
  private readonly size: number;

  constructor(
    private readonly typesetter: MathTypesetter,
    {
      schedule = (run) => setTimeout(run, 0),
      now = () => performance.now(),
      sliceMs = 8,
      size = 2000,
    }: MathTypesetCacheOptions = {},
  ) {
    this.schedule = schedule;
    this.now = now;
    this.sliceMs = sliceMs;
    this.size = size;
  }

  /**
   * The result for the source if there is one. Otherwise `done` is called
   * with it once it is typeset, unless `cancel` is called first.
   */
  request(
    latex: string,
    display: boolean,
    done: (result: TypesetResult) => void,
  ): { result: TypesetResult | null; cancel: () => void } {
    const key = keyOf(latex, display);
    const cached = this.results.get(key);
    if (cached) {
      this.results.delete(key);
      this.results.set(key, cached);
      return { result: cached, cancel: () => {} };
    }
    let listeners = this.waiting.get(key);
    if (!listeners) {
      listeners = new Set();
      this.waiting.set(key, listeners);
    }
    listeners.add(done);
    this.start();
    return {
      result: null,
      cancel: () => {
        listeners.delete(done);
        if (listeners.size === 0 && this.waiting.get(key) === listeners) {
          this.waiting.delete(key);
        }
      },
    };
  }

  private start(): void {
    if (this.typeset) {
      this.scheduleRun();
      return;
    }
    if (this.loadStarted) {
      return;
    }
    this.loadStarted = true;
    this.typesetter.load().then(
      (typeset) => {
        this.typeset = typeset;
        this.scheduleRun();
      },
      // Without the engine, math keeps showing its source.
      (error: unknown) => console.error(error),
    );
  }

  private scheduleRun(): void {
    if (this.scheduled || this.waiting.size === 0) {
      return;
    }
    this.scheduled = true;
    this.schedule(this.run);
  }

  private readonly run = (): void => {
    this.scheduled = false;
    const typeset = this.typeset;
    if (!typeset) {
      return;
    }
    const start = this.now();
    for (const [key, listeners] of this.waiting) {
      this.waiting.delete(key);
      const result = typesetKey(typeset, key);
      this.results.set(key, result);
      if (this.results.size > this.size) {
        const oldest = this.results.keys().next().value;
        if (oldest !== undefined) {
          this.results.delete(oldest);
        }
      }
      for (const listener of listeners) {
        listener(result);
      }
      if (this.now() - start >= this.sliceMs) {
        break;
      }
    }
    this.scheduleRun();
  };
}

function keyOf(latex: string, display: boolean): string {
  return `${display ? 'D' : 'I'}${latex}`;
}

function typesetKey(typeset: TypesetMath, key: string): TypesetResult {
  try {
    return { element: typeset(key.slice(1), key[0] === 'D') };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** The source as VFM writes it for MathJax, which shows until it is typeset. */
function sourceOf(latex: string, display: boolean): string {
  return display ? `$$${latex}$$` : `\\(${latex}\\)`;
}

/**
 * Shows math typeset. The node, and so what is copied and saved, stays the
 * schema's: only the view changes. Its state is in `data-math-view`.
 */
export class MathView implements NodeView {
  readonly dom: HTMLElement;
  private node: ProseMirrorNode;
  private cancel: () => void = () => {};

  constructor(
    node: ProseMirrorNode,
    private readonly cache: MathTypesetCache,
    document: Document,
  ) {
    this.node = node;
    this.dom = document.createElement('span');
    this.dom.contentEditable = 'false';
    this.render();
  }

  private get latex(): string {
    return String(this.node.attrs.latex ?? '');
  }

  private get display(): boolean {
    return Boolean(this.node.attrs.display);
  }

  private render(): void {
    this.cancel();
    this.dom.className = this.display ? 'math display' : 'math inline';
    const { result, cancel } = this.cache.request(
      this.latex,
      this.display,
      (it) => this.show(it),
    );
    this.cancel = cancel;
    this.show(result);
  }

  private show(result: TypesetResult | null): void {
    const source = sourceOf(this.latex, this.display);
    if (result && 'element' in result) {
      this.dom.dataset.mathView = 'typeset';
      this.dom.title = source;
      this.dom.replaceChildren(result.element.cloneNode(true));
      return;
    }
    this.dom.dataset.mathView = result ? 'error' : 'pending';
    this.dom.title = result && 'error' in result ? result.error : source;
    this.dom.textContent = source;
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) {
      return false;
    }
    const same =
      node.attrs.latex === this.node.attrs.latex &&
      node.attrs.display === this.node.attrs.display;
    this.node = node;
    if (!same) {
      this.render();
    }
    return true;
  }

  // The typesetter's output is not content ProseMirror reads.
  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.cancel();
  }
}

const caches = new WeakMap<MathTypesetter, MathTypesetCache>();

function cacheOf(typesetter: MathTypesetter): MathTypesetCache {
  let cache = caches.get(typesetter);
  if (!cache) {
    cache = new MathTypesetCache(typesetter);
    caches.set(typesetter, cache);
  }
  return cache;
}

export interface MathTypesettingOptions {
  /** Without one, math shows its source, as in Node and in tests. */
  typesetter: MathTypesetter | null;
}

/**
 * Typesets math in the editor's view with the typesetter given. Editors
 * given the same typesetter share what it typeset.
 */
export const MathTypesetting = Extension.create<MathTypesettingOptions>({
  name: 'mathTypesetting',

  addOptions() {
    return { typesetter: null };
  },

  addProseMirrorPlugins() {
    const { typesetter } = this.options;
    if (!typesetter) {
      return [];
    }
    const cache = cacheOf(typesetter);
    return [
      new Plugin({
        key: new PluginKey('mathTypesetting'),
        props: {
          nodeViews: {
            math: (node, view) =>
              new MathView(node, cache, view.dom.ownerDocument),
          },
        },
      }),
    ];
  },
});
