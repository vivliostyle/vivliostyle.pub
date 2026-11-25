import { EditorContent, EditorContext, useCurrentEditor } from '@tiptap/react';
import { invariant } from 'outvariant';
import type React from 'react';
import { use, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSnapshot } from 'valtio';

import { m } from '../../generated/paraglide/messages';
import { setThemeCss } from '../../libs/editor/theme-support';
import { $content, $theme } from '../../stores/accessors';
import type { ContentId } from '../../stores/proxies/content';
import editorBaseCss from './editor-base.css?inline';
import editorOverrideCss from './editor-theme-override.css?inline';
import { ImageToolbar } from './image-toolbar';
import { SelectionToolbar } from './selection-toolbar';
import { TriggerMenu } from './trigger-menu';

function ShadowContent({
  children,
  root,
}: React.PropsWithChildren<{ root: Element | DocumentFragment }>) {
  return createPortal(children, root);
}

const editorBaseStyleSheet = new CSSStyleSheet();
editorBaseStyleSheet.replaceSync(editorBaseCss.replace(/:root/g, ':host'));
if (import.meta.hot) {
  import.meta.hot.accept('./editor-base.css?inline', (newModule) => {
    if (!newModule) return;
    const { default: editorBaseCss } = newModule;
    editorBaseStyleSheet.replaceSync(editorBaseCss.replace(/:root/g, ':host'));
  });
}

const toHostScope = (css: string | undefined) =>
  css?.replace(/:root/g, ':host') ?? '';

export function EditorStyleContainer({
  children,
  bundledCss,
  customCss,
}: React.PropsWithChildren<{ bundledCss?: string; customCss?: string }>) {
  const node = useRef<HTMLDivElement | null>(null);
  const [root, setRoot] = useState<DocumentFragment | null>(null);
  // Separate sheets, so that editing the user CSS never reparses the theme package
  const [sheets] = useState(() => ({
    theme: new CSSStyleSheet(),
    override: new CSSStyleSheet(),
    custom: new CSSStyleSheet(),
  }));

  useLayoutEffect(() => {
    if (!node.current || node.current.shadowRoot) {
      return;
    }
    const shadowRoot = node.current.attachShadow({
      mode: 'open',
      delegatesFocus: false,
    });
    shadowRoot.adoptedStyleSheets = [
      editorBaseStyleSheet,
      sheets.theme,
      sheets.override,
      sheets.custom,
    ];
    setRoot(shadowRoot);
  }, [sheets]);

  useLayoutEffect(() => {
    sheets.theme.replaceSync(toHostScope(bundledCss));
  }, [sheets, bundledCss]);
  useLayoutEffect(() => {
    sheets.override.replaceSync(editorOverrideCss);
  }, [
    sheets,
    // Add imported CSS as dependency to re-apply on HMR
    editorOverrideCss,
  ]);
  useLayoutEffect(() => {
    sheets.custom.replaceSync(toHostScope(customCss));
  }, [sheets, customCss]);
  return (
    <div ref={node} className="h-full">
      {root && <ShadowContent root={root}>{children}</ShadowContent>}
    </div>
  );
}

function cssString(text: string): string {
  return `"${text.replace(/["\\]/g, '\\$&').replace(/\n/g, ' ')}"`;
}

// Read by the editor's CSS, which shows syntax that has no text of its own.
// The text of the heading a section end ends comes from an attribute, which
// the CSS puts between the two parts of the message.
function labelProperties(): React.CSSProperties {
  const [before = '', after = ''] = m
    .content_editor_section_end({ heading: '\u0000' })
    .split('\u0000');
  return {
    '--content-editor-section-end': cssString(before),
    '--content-editor-section-end-after': cssString(after),
    '--content-editor-section-end-nothing': cssString(
      m.content_editor_section_end_nothing(),
    ),
    '--content-editor-toc': cssString(m.content_editor_toc()),
    '--content-editor-footnote-undefined': cssString(
      m.content_editor_footnote_undefined(),
    ),
    '--content-editor-footnote-unreferenced': cssString(
      m.content_editor_footnote_unreferenced(),
    ),
    '--content-editor-reference-missing': cssString(
      m.content_editor_reference_missing(),
    ),
    '--content-editor-footnote-duplicate': cssString(
      m.content_editor_footnote_duplicate(),
    ),
  } as React.CSSProperties;
}

export function EditArea() {
  const { editor } = useCurrentEditor();

  return (
    <EditorContent
      {...{ editor }}
      className="editor-root"
      style={labelProperties()}
    />
  );
}

export default function ContentEditor({ contentId }: { contentId: ContentId }) {
  const contentSnap = useSnapshot($content).valueOrThrow();
  const themeSnap = useSnapshot($theme).valueOrThrow();
  const file = contentSnap.files.get(contentId);
  invariant(file, `Editor not found for contentId: ${contentId}`);
  const installedTheme =
    themeSnap.installPromise && use(themeSnap.installPromise);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const bundledCss = installedTheme?.bundledCss ?? '';
  const customCss =
    themeSnap.bundledStylesheetCss ??
    themeSnap.stylesheets.map((it) => it.css).join('\n');

  useLayoutEffect(() => {
    setThemeCss(file.editor, `${bundledCss}\n${customCss}`);
  }, [file.editor, bundledCss, customCss]);

  return (
    <EditorContext.Provider value={{ editor: file.editor }}>
      <div ref={wrapperRef} className="relative h-full">
        <EditorStyleContainer bundledCss={bundledCss} customCss={customCss}>
          <EditArea />
        </EditorStyleContainer>
        <TriggerMenu />
        <SelectionToolbar containerRef={wrapperRef} />
        <ImageToolbar containerRef={wrapperRef} />
      </div>
    </EditorContext.Provider>
  );
}
