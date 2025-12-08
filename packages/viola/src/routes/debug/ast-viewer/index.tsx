import { createFileRoute } from '@tanstack/react-router';
import basex from 'base-x';
import { useCallback, useState } from 'react';
import * as v from 'valibot';

import {
  AstViewerContext,
  CssEditorPane,
  defaultAstViewerContext,
  RawEditorPane,
  RichEditorPane,
  TiptapAstViewerPane,
  VfmAstViewerPane,
  VfmPreviewPane,
} from './-components/ast-viewer';

const bs62 = basex(
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
);

const RouteSearchSchema = v.object({
  md: v.optional(v.string()),
  css: v.optional(v.string()),
  tab: v.optional(v.picklist(['tree', 'html', 'json'])),
});

export const Route = createFileRoute('/debug/ast-viewer/')({
  component: AstViewerView,
  validateSearch: RouteSearchSchema,
});

function AstViewerView() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const [contextValue, setContextValue] = useState<AstViewerContext>({
    ...defaultAstViewerContext,
    markdown: search.md ? new TextDecoder().decode(bs62.decode(search.md)) : '',
    css: search.css
      ? new TextDecoder().decode(bs62.decode(search.css))
      : defaultAstViewerContext.css,
    selectingAstTab: search.tab ?? defaultAstViewerContext.selectingAstTab,
    onMarkdownChange: useCallback(
      (markdown: string) => {
        setContextValue((prev) => ({ ...prev, markdown }));
        navigate({
          search: (prev) => ({
            ...prev,
            md: markdown
              ? bs62.encode(new TextEncoder().encode(markdown))
              : undefined,
          }),
          replace: true,
        });
      },
      [search],
    ),
    onCssChange: useCallback((css: string) => {
      setContextValue((prev) => ({ ...prev, css }));
      navigate({
        search: (prev) => ({
          ...prev,
          css:
            css === defaultAstViewerContext.css
              ? undefined
              : bs62.encode(new TextEncoder().encode(css)),
        }),
        replace: true,
      });
    }, [navigate]),
    onSelectingAstTabChange: useCallback(
      (selectingAstTab: 'tree' | 'html' | 'json') => {
        setContextValue((prev) => ({ ...prev, selectingAstTab }));
        navigate({
          search: (prev) => ({
            ...prev,
            tab:
              selectingAstTab === defaultAstViewerContext.selectingAstTab
                ? undefined
                : selectingAstTab,
          }),
          replace: true,
        });
      },
      [search],
    ),
    onEditorAstChange: useCallback((editorAst: unknown) => {
      setContextValue((prev) => ({ ...prev, editorAst }));
    }, []),
    onEditorHtmlChange: useCallback((editorHtml: string) => {
      setContextValue((prev) => ({ ...prev, editorHtml }));
    }, []),
  });

  return (
    <AstViewerContext.Provider value={contextValue}>
      <div className="grid grid-cols-3 grid-rows-2 divide-x divide-y divide-neutral-300 size-full *:size-full *:overflow-auto *:overscroll-contain *:scrollbar-stable *:scroll-py-4">
        <section>
          <div className="sticky top-0 bg-background px-6 py-2 border-b border-neutral-300 text-secondary-foreground font-semibold">
            VFM Editor
          </div>
          <RawEditorPane />
        </section>
        <section className="@container flex flex-col">
          <div className="sticky top-0 bg-background px-6 py-2 border-b border-neutral-300 text-secondary-foreground font-semibold">
            Text Editor
          </div>
          <div className="flex-1">
            <RichEditorPane />
          </div>
        </section>
        <section className="bg-accent">
          <TiptapAstViewerPane />
        </section>
        <section>
          <div className="sticky top-0 bg-background px-6 py-2 border-b border-neutral-300 text-secondary-foreground font-semibold">
            CSS Editor
          </div>
          <CssEditorPane />
        </section>
        <section className="@container flex flex-col">
          <div className="sticky top-0 bg-background px-6 py-2 border-b border-neutral-300 text-secondary-foreground font-semibold">
            VFM Preview
          </div>
          <div className="px-[min(6cqw,2rem)] cursor-default select-none">
            <VfmPreviewPane />
          </div>
        </section>
        <section className="bg-accent">
          <VfmAstViewerPane />
        </section>
      </div>
    </AstViewerContext.Provider>
  );
}
