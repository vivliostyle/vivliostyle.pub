import {
  BubbleMenu,
  type EditorEvents,
  EditorProvider,
  FloatingMenu,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useCallback, useState } from 'react';
import { useDebounce } from 'react-use';
import editorStyle from './editor.module.css';

const extensions = [StarterKit];

export function Editor() {
  const [contentHtml, setContentHtml] = useState('');
  const handleUpdate = useCallback(({ editor }: EditorEvents['update']) => {
    setContentHtml(editor.getHTML());
  }, []);
  useDebounce(
    () => {
      console.log(contentHtml);
    },
    1000,
    [contentHtml],
  );

  return (
    <div className="bg-neutral-200">
      <EditorProvider
        extensions={extensions}
        editorContainerProps={{ className: editorStyle.editor }}
        onUpdate={handleUpdate}
      >
        <FloatingMenu editor={null}>This is the floating menu</FloatingMenu>
        <BubbleMenu editor={null}>This is the bubble menu</BubbleMenu>
      </EditorProvider>
    </div>
  );
}
