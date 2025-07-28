import { EditorContent, EditorContext, useCurrentEditor } from '@tiptap/react';
import { invariant } from 'outvariant';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSnapshot } from 'valtio';

import { $content, type ContentId } from '../../stores/content';
import { $theme } from '../../stores/theme';
import editorBaseCss from './editor-base.css?inline';
import editorOverrideCss from './editor-theme-override.css?inline';

function ShadowContent({
  children,
  root,
}: React.PropsWithChildren<{ root: Element | DocumentFragment }>) {
  return createPortal(children, root);
}

const editorBaseStyleSheet = new CSSStyleSheet();
editorBaseStyleSheet.replaceSync(
  `${editorBaseCss.replace(/:root/g, ':host')}${editorOverrideCss}`,
);

const editorThemeStyleSheet = new CSSStyleSheet();

function EditorStyleContainer({ children }: React.PropsWithChildren) {
  const node = useRef<HTMLDivElement | null>(null);
  const [root, setRoot] = useState<DocumentFragment | null>(null);
  const themeSnap = useSnapshot($theme);

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
      editorThemeStyleSheet,
    ];
    setRoot(shadowRoot);
  }, [node]);

  useEffect(() => {
    const css = `
      ${themeSnap.bundledCss?.replace(/:root/g, ':host') ?? ''}
      ${editorOverrideCss}
      ${themeSnap.customCss.replace(/:root/g, ':host')}`;
    editorThemeStyleSheet.replaceSync(css);
  }, [themeSnap.bundledCss, themeSnap.customCss]);

  return (
    <div ref={node} className="h-full">
      {root && <ShadowContent root={root}>{children}</ShadowContent>}
    </div>
  );
}

function EditArea() {
  const { editor } = useCurrentEditor();

  return (
    <EditorStyleContainer>
      <EditorContent {...{ editor }} className="editor-root" />
    </EditorStyleContainer>
  );
}

export default function ContentEditor({ contentId }: { contentId: ContentId }) {
  const contentSnap = useSnapshot($content);
  const file = contentSnap.files.get(contentId);
  invariant(file, `Editor not found for contentId: ${contentId}`);

  return (
    <EditorContext.Provider value={{ editor: file.editor }}>
      <EditArea />
    </EditorContext.Provider>
  );
}
