import { EditorContent, EditorContext, useCurrentEditor } from '@tiptap/react';
import { invariant } from 'outvariant';
import type React from 'react';
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
editorBaseStyleSheet.replaceSync(editorBaseCss.replace(/:root/g, ':host'));
if (import.meta.hot) {
  import.meta.hot.accept('./editor-base.css?inline', (newModule) => {
    if (!newModule) return;
    const { default: editorBaseCss } = newModule;
    editorBaseStyleSheet.replaceSync(editorBaseCss.replace(/:root/g, ':host'));
  });
}

export function EditorStyleContainer({
  children,
  bundledCss,
  customCss,
}: React.PropsWithChildren<{ bundledCss?: string; customCss?: string }>) {
  const node = useRef<HTMLDivElement | null>(null);
  const [root, setRoot] = useState<DocumentFragment | null>(null);
  const editorConfigurableStyleSheet = useRef(new CSSStyleSheet());

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
      editorConfigurableStyleSheet.current,
    ];
    setRoot(shadowRoot);
  }, [node]);

  useEffect(() => {
    const css = `${bundledCss?.replace(/:root/g, ':host') ?? ''}
${editorOverrideCss}
${customCss?.replace(/:root/g, ':host') ?? ''}`;
    editorConfigurableStyleSheet.current.replaceSync(css);
  }, [
    bundledCss,
    customCss,
    // Add imported CSS as dependency to re-apply on HMR
    editorOverrideCss,
  ]);
  return (
    <div ref={node} className="h-full">
      {root && <ShadowContent root={root}>{children}</ShadowContent>}
    </div>
  );
}

export function EditArea() {
  const { editor } = useCurrentEditor();

  return <EditorContent {...{ editor }} className="editor-root" />;
}

export default function ContentEditor({ contentId }: { contentId: ContentId }) {
  const contentSnap = useSnapshot($content);
  const themeSnap = useSnapshot($theme);
  const file = contentSnap.files.get(contentId);
  invariant(file, `Editor not found for contentId: ${contentId}`);

  return (
    <EditorContext.Provider value={{ editor: file.editor }}>
      <EditorStyleContainer
        bundledCss={themeSnap.bundledCss ?? ''}
        customCss={themeSnap.customCss ?? ''}
      >
        <EditArea />
      </EditorStyleContainer>
    </EditorContext.Provider>
  );
}
