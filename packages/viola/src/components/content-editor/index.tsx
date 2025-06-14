import { EditorContent, EditorContext, useCurrentEditor } from '@tiptap/react';
import { invariant } from 'outvariant';
import { useEffect, useLayoutEffect, useRef } from 'react';
import shadowRoot from 'react-shadow';
import { useSnapshot } from 'valtio';
import { $content, type ContentId } from '../../stores/content';
import { $theme } from '../../stores/theme';
import editorBaseCss from './editor-base.css?inline';
import editorOverrideCss from './editor-theme-override.css?inline';

const editorBaseStyleSheet = new CSSStyleSheet();
editorBaseStyleSheet.replaceSync(
  `${editorBaseCss.replace(/:root/g, ':host')}${editorOverrideCss}`,
);

const editorThemeStyleSheet = new CSSStyleSheet();

function EditorStyleContainer({ children }: React.PropsWithChildren) {
  const themeSnap = useSnapshot($theme);
  const shadowRootRef = useRef<ShadowRoot | null>(null);

  useLayoutEffect(() => {
    if (
      !shadowRootRef.current ||
      shadowRootRef.current.adoptedStyleSheets.length > 0
    ) {
      return;
    }
    shadowRootRef.current.adoptedStyleSheets = [
      editorBaseStyleSheet,
      editorThemeStyleSheet,
    ];
  }, []);

  useEffect(() => {
    const css = `
      ${themeSnap.bundledCss?.replace(/:root/g, ':host') ?? ''}
      ${editorOverrideCss}
      ${themeSnap.customCss.replace(/:root/g, ':host')}`;
    editorThemeStyleSheet.replaceSync(css);
  }, [themeSnap.bundledCss, themeSnap.customCss]);

  return (
    <shadowRoot.div
      className="h-full"
      ref={(el) => {
        shadowRootRef.current = el?.shadowRoot ?? null;
      }}
    >
      {children}
    </shadowRoot.div>
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
