import { type EditorEvents, EditorProvider } from '@tiptap/react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import shadowRoot from 'react-shadow';
import { useDebounce } from 'react-use';
import { useSnapshot } from 'valtio';
import { type ContentId, content } from '../../stores/content';
import { sandbox } from '../../stores/sandbox';
import editorBaseCss from './editor.css?inline';

function EditorStyleContainer({ children }: React.PropsWithChildren) {
  const shadowRootRef = useRef<ShadowRoot | null>(null);

  useLayoutEffect(() => {
    if (
      !shadowRootRef.current ||
      shadowRootRef.current.adoptedStyleSheets.length > 0
    ) {
      return;
    }
    const editorStyleSheet = new CSSStyleSheet();
    editorStyleSheet.replaceSync(editorBaseCss.replace(/:root/g, ':host'));
    shadowRootRef.current.adoptedStyleSheets = [editorStyleSheet];
  }, []);

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

export function Editor({ contentId }: { contentId: ContentId }) {
  const contentSnap = useSnapshot(content);
  const editor = contentSnap.editor[contentId];
  const [contentHtml, setContentHtml] = useState('');
  const handleUpdate = useCallback(({ editor }: EditorEvents['update']) => {
    setContentHtml(editor.getHTML());
  }, []);
  useDebounce(
    () => {
      sandbox.files['manuscript.html'] = contentHtml;
    },
    1000,
    [contentHtml],
  );

  if (!editor) {
    return null;
  }

  return (
    <>
      <EditorStyleContainer>
        <EditorProvider
          key={contentId}
          extensions={editor.extensions}
          editorContainerProps={{
            className: 'editor-root',
          }}
          onUpdate={handleUpdate}
        />
      </EditorStyleContainer>
    </>
  );
}
