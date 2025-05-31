import {
  type EditorEvents,
  EditorProvider,
  type Extensions,
} from '@tiptap/react';
import { invariant } from 'outvariant';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import shadowRoot from 'react-shadow';
import { useDebounce } from 'react-use';
import { useSnapshot } from 'valtio';
import { type ContentId, content } from '../../stores/content';
import { sandbox } from '../../stores/sandbox';
import { theme } from '../../stores/theme';
import editorBaseCss from './editor-base.css?inline';
import editorOverrideCss from './editor-theme-override.css?inline';

const editorBaseStyleSheet = new CSSStyleSheet();
editorBaseStyleSheet.replaceSync(
  `${editorBaseCss.replace(/:root/g, ':host')}${editorOverrideCss}`,
);

const editorThemeStyleSheet = new CSSStyleSheet();

function EditorStyleContainer({ children }: React.PropsWithChildren) {
  const themeSnap = useSnapshot(theme);
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
    editorThemeStyleSheet.replaceSync(
      `${themeSnap.bundledCss?.replace(/:root/g, ':host') ?? ''}${editorOverrideCss}`,
    );
  }, [themeSnap.bundledCss]);

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

export function ContentEditor({ contentId }: { contentId: ContentId }) {
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

  invariant(editor, `Editor not found for contentId: ${contentId}`);
  return (
    <EditorStyleContainer>
      <EditorProvider
        key={contentId}
        extensions={editor.extensions as Extensions}
        editorContainerProps={{
          className: 'editor-root',
        }}
        onUpdate={handleUpdate}
      />
    </EditorStyleContainer>
  );
}
