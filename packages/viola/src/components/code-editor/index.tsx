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

export default function CodeEditor({
  defaultCode = '',
  onCodeUpdate,
  ...other
}: Required<Pick<React.HTMLAttributes<HTMLDivElement>, 'aria-label'>> & {
  defaultCode?: string;
  onCodeUpdate?: (code: string) => void;
}) {
  const currentCode = useRef('');
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView>(null);

  useEffect(() => {
    if (!editorContainerRef.current) {
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
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) {
            return;
          }
          const code = update.state.doc.toString();
          currentCode.current = code;
          onCodeUpdate?.(code);
        }),
        css(),
      ],
      parent: editorContainerRef.current,
    });
    editorView.contentDOM.setAttribute('tabIndex', '-1');
    editorViewRef.current = editorView;
    return () => {
      editorViewRef.current?.destroy();
    };
  }, [onCodeUpdate]);

  useEffect(() => {
    const editorView = editorViewRef.current;
    if (!editorView || currentCode.current === defaultCode) {
      return;
    }
    window.requestAnimationFrame(() => {
      editorView.dispatch({
        changes: {
          from: 0,
          to: editorView.state.doc.length,
          insert: defaultCode,
        },
      });
    });
  }, [defaultCode]);

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
      {...other}
      ref={editorContainerRef}
      aria-autocomplete="list"
      aria-multiline="true"
      role="textbox"
      tabIndex={0}
      translate="no"
      onKeyDown={handleParentKeyDown}
    />
  );
}
