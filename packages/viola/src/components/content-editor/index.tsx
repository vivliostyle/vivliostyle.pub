import {
  EditorContent,
  EditorContext,
  type EditorEvents,
  useCurrentEditor,
  useEditor,
} from '@tiptap/react';
import { invariant } from 'outvariant';
import { join } from 'pathe';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import shadowRoot from 'react-shadow';
import { useDebounce } from 'react-use';
import { ref, useSnapshot } from 'valtio';
import { $content, type ContentId } from '../../stores/content';
import { $sandbox } from '../../stores/sandbox';
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

function EditMenu() {
  const { editor } = useCurrentEditor();

  return (
    <div className="flex items-center gap-2 w-full justify-end">
      <button
        type="button"
        onClick={() =>
          editor?.chain().focus().exportVfm({ onExport: console.log }).run()
        }
      >
        Save
      </button>

      <button type="button" onClick={() => console.log(editor?.getHTML())}>
        HTML
      </button>
    </div>
  );
}

export default function ContentEditor({ contentId }: { contentId: ContentId }) {
  const contentSnap = useSnapshot($content);
  const file = contentSnap.files.get(contentId);
  invariant(file, `Editor not found for contentId: ${contentId}`);
  const [contentHtml, setContentHtml] = useState('');
  const handleUpdate = useCallback(({ editor }: EditorEvents['update']) => {
    setContentHtml(editor.getHTML());
  }, []);
  useDebounce(
    () => {
      $sandbox.files[
        join($sandbox.vivliostyleConfig.entryContext || '', file.filename)
      ] = ref(new Blob([contentHtml], { type: 'text/html' }));
    },
    1000,
    [contentHtml],
  );

  const editor = useEditor({
    extensions: file.editor.extensions,
    onUpdate: handleUpdate,
  });

  return (
    <EditorContext.Provider value={{ editor }}>
      <EditMenu />
      <EditArea />
    </EditorContext.Provider>
  );
}
