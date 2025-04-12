import Collaboration from '@tiptap/extension-collaboration';
import Placeholder from '@tiptap/extension-placeholder';
import {
  BubbleMenu,
  type EditorEvents,
  EditorProvider,
  FloatingMenu,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useCallback, useState } from 'react';
import { useDebounce } from 'react-use';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import { cn } from '#ui/lib/utils';
import { cli } from '../stores/cli';
import editorStyle from './editor.module.css';

const ydoc = new Y.Doc();
new IndexeddbPersistence('viola', ydoc);

const extensions = [
  StarterKit,
  Placeholder.configure({
    placeholder: 'Start typing...',
  }),
  Collaboration.configure({
    document: ydoc,
  }),
];

export function Editor() {
  const [contentHtml, setContentHtml] = useState('');
  const handleUpdate = useCallback(({ editor }: EditorEvents['update']) => {
    setContentHtml(editor.getHTML());
  }, []);
  useDebounce(
    () => {
      cli.files['manuscript.html'] = contentHtml;
    },
    1000,
    [contentHtml],
  );

  return (
    <EditorProvider
      extensions={extensions}
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
