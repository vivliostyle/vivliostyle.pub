import temmlUrl from 'temml/dist/temml.mjs?url';

import type { MathTypesetter } from '@v/tiptap-extensions';

/**
 * Typesets with Temml, which VFM's MathML renderer uses too. Its MathML is
 * laid out by the browser, so it needs no stylesheet or fonts of its own in
 * the editor's Shadow DOM. It is loaded only for documents with math.
 */
export const temmlTypesetter: MathTypesetter = {
  load: async () => {
    // Loaded as the file it ships as: bundling it rewrites the lone
    // surrogates in its lexer's pattern, and every control word then fails.
    const { default: temml }: typeof import('temml') = await import(
      /* @vite-ignore */ temmlUrl
    );
    return (latex, display) => {
      const element = document.createElement('span');
      // VFM trims the LaTeX before it gives it to Temml.
      temml.render(latex.trim(), element, {
        displayMode: display,
        throwOnError: true,
      });
      return element;
    };
  },
};
