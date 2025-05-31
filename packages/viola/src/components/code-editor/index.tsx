import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { css } from '@codemirror/lang-css';
import {
  bracketMatching,
  defaultHighlightStyle,
  syntaxHighlighting,
} from '@codemirror/language';
import {
  EditorView,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { useCallback, useEffect, useRef } from 'react';

export function CodeEditor(
  props: Required<Pick<React.HTMLAttributes<HTMLDivElement>, 'aria-label'>>,
) {
  const editorParentRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView>(null);

  useEffect(() => {
    if (!editorParentRef.current) {
      return;
    }

    const editorView = new EditorView({
      extensions: [
        lineNumbers(),
        highlightSpecialChars(),
        history(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        closeBrackets(),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        EditorView.theme({
          '&.cm-editor.cm-focused': {
            outline: 'none',
          },
        }),
        css(),
      ],
      parent: editorParentRef.current,
    });
    editorView.contentDOM.setAttribute('tabIndex', '-1');
    editorViewRef.current = editorView;
    return () => {
      editorViewRef.current?.destroy();
    };
  }, []);

  const handleParentKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        editorViewRef.current?.focus();
      }
    },
    [],
  );

  return (
    <div
      {...props}
      ref={editorParentRef}
      aria-autocomplete="list"
      aria-multiline="true"
      role="textbox"
      tabIndex={0}
      translate="no"
      onKeyDown={handleParentKeyDown}
    />
  );
}
