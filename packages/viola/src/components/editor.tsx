import {
  BubbleMenu,
  type EditorEvents,
  EditorProvider,
  FloatingMenu,
} from '@tiptap/react';
import { useCallback, useState } from 'react';
import { useDebounce } from 'react-use';
import { useSnapshot } from 'valtio';
import { cn } from '#ui/lib/utils';
import { type ContentId, content } from '../stores/content';
import { sandbox } from '../stores/sandbox';
import editorStyle from './editor.module.css';

export function Editor({ contentId }: { contentId: ContentId }) {
  const contentSnapshot = useSnapshot(content);
  const editor = contentSnapshot.editor[contentId];
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
    <EditorProvider
      key={contentId}
      extensions={editor.extensions}
      editorContainerProps={{
        className: cn(editorStyle.editor, 'h-full'),
      }}
      editorProps={{
        attributes: {
          class:
            'min-h-full max-w-full px-8 pt-16 pb-[calc(100svh_-_12rem)] focus-visible:outline-none',
        },
      }}
      onUpdate={handleUpdate}
    >
      <FloatingMenu editor={null}>This is the floating menu</FloatingMenu>
      <BubbleMenu editor={null}>This is the bubble menu</BubbleMenu>
    </EditorProvider>
  );
}
