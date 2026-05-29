import { invariant } from 'outvariant';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ref } from 'valtio';

import { m } from '../../generated/paraglide/messages';
import { debounce } from '../../libs/debounce';
import { $content, $sandbox } from '../../stores/accessors';
import type { ContentId } from '../../stores/proxies/content';
import { SandboxFile } from '../../stores/proxies/sandbox';
import CodeEditor from '../code-editor';

// Side-menu summary derived directly from raw markdown, for the source editor
// where the collaborative editor instance is intentionally not kept in sync.
// The visual editor reuses its own getText-based path; this approximates it by
// stripping YAML frontmatter and leading block markers from the first line.
function deriveSummaryFromMarkdown(markdown: string): string {
  const lines = markdown.split('\n');
  // Skip YAML frontmatter only when it is properly closed; a leading `---`
  // without a closing fence is just a horizontal rule, not frontmatter.
  let start = 0;
  if (lines[0]?.trim() === '---') {
    const close = lines.findIndex(
      (line, idx) => idx > 0 && line.trim() === '---',
    );
    if (close !== -1) {
      start = close + 1;
    }
  }
  for (let i = start; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed === '---') {
      continue;
    }
    return trimmed
      .replace(/^#{1,6}\s+/, '')
      .replace(/^>\s?/, '')
      .replace(/^([-*+]|\d+\.)\s+/, '')
      .trim();
  }
  return '';
}

export default function SourceEditor({ contentId }: { contentId: ContentId }) {
  const content = $content.valueOrThrow();
  const sandbox = $sandbox.valueOrThrow();
  const file = content.files.get(contentId);
  invariant(file, `Source editor: file not found for contentId: ${contentId}`);
  const { editor, filename } = file;

  // The collaborative XmlFragment stays the source of truth; the source view
  // is seeded once from its current markdown and never re-reads it while open.
  const latestCode = useRef(editor.getMarkdown());
  const initialCode = useRef(latestCode.current).current;

  const saveToSandbox = useMemo(
    () =>
      debounce(
        (code: string) => {
          file.summary = deriveSummaryFromMarkdown(code);
          sandbox.files[filename] = ref(new SandboxFile('text/markdown', code));
        },
        1000,
        { trailing: true },
      ),
    [sandbox, filename, file],
  );

  const handleCodeUpdate = useCallback(
    (code: string) => {
      latestCode.current = code;
      saveToSandbox(code);
    },
    [saveToSandbox],
  );

  // Switching back to the visual editor unmounts this component. Flush the
  // latest markdown into the XmlFragment then; emitUpdate runs the editor's
  // own save path so the sandbox file and server sync reconverge.
  useEffect(() => {
    return () => {
      editor.commands.setContent(latestCode.current, {
        contentType: 'markdown',
        emitUpdate: true,
      });
    };
  }, [editor]);

  return (
    <CodeEditor
      aria-label={m.edit_source_editor_aria()}
      className="w-full"
      code={initialCode}
      language="markdown"
      lineWrapping
      onCodeUpdate={handleCodeUpdate}
    />
  );
}
