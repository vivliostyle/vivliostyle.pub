import { Editor, type Extensions } from '@tiptap/core';
import { Collaboration } from '@tiptap/extension-collaboration';
import { Placeholder } from '@tiptap/extensions';
import { dirname, relative } from 'pathe';
import { ref } from 'valtio';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

import { PubExtensions } from '@v/tiptap-extensions';
import { InlineTrigger } from '@v/tiptap-extensions/inline-trigger';
import { debounce } from '../libs/debounce';
import { $projects } from '../stores/accessors';
import type { ContentId } from '../stores/proxies/content';
import type { ProjectId } from '../stores/proxies/project';
import { SandboxFile } from '../stores/proxies/sandbox';
import { createSandboxImageSaver } from './editor/image-saver';
import { getAllTriggers, inlineMenuState } from './editor/inline-menu';
import { insertExistingAsset } from './editor/insert-asset';
import { insertImageFiles } from './editor/insert-image';
import { YUndoCursorFix } from './editor/y-undo-cursor-fix';

import './editor/inline-menu.media';

function editorPersistenceKey(projectId: ProjectId, filename: string): string {
  return `viola:editor:${projectId}:${filename}`;
}

export async function setupEditor({
  projectId,
  contentId,
  filename,
  entryContext,
  initialFile,
}: {
  projectId: ProjectId;
  contentId: ContentId;
  filename?: string;
  entryContext?: string;
  initialFile?: SandboxFile;
}) {
  const fileDir = filename ? dirname(filename) : '';
  let basePath = filename && relative(entryContext || '', dirname(filename));
  if (basePath?.startsWith('.')) {
    basePath = undefined;
  }

  const doc = new Y.Doc();
  // Editor state is persisted to IndexedDB keyed by a stable project + file
  // path. contentId is regenerated on every load, so it cannot serve as the
  // persistence key.
  const persistence = filename
    ? new IndexeddbPersistence(editorPersistenceKey(projectId, filename), doc)
    : undefined;

  // Resolve the owning project via projectId rather than the current-project
  // accessors so persisted-state hydration writes back to the right sandbox
  // even when this project has not yet been made current.
  const saveContent = debounce(
    (editor: Editor) => {
      const project = $projects.value[projectId];
      const sandbox = project?.sandbox;
      if (!project || !sandbox) {
        return;
      }
      const file = project.content.files.get(contentId);
      if (!file) {
        return;
      }
      file.summary =
        editor
          .getText({ blockSeparator: '\n' })
          .split('\n')
          .find((s) => s.trim())
          ?.trim() || '';
      const markdown = editor.getMarkdown();
      sandbox.files[file.filename] = ref(
        new SandboxFile('text/markdown', markdown),
      );
    },
    1000,
    { trailing: true },
  );

  const extensions = [
    PubExtensions.configure({
      basePath,
      fileDir,
      imageSaver: createSandboxImageSaver({ fileDir }),
      onFileDrop: (editor, files, pos) => {
        insertImageFiles({ editor, files, pos });
      },
      onFilePaste: (editor, files) => {
        insertImageFiles({ editor, files });
      },
      onDrop: (editor, payload, pos) => {
        switch (payload.type) {
          case 'asset':
            insertExistingAsset({
              editor,
              assetPath: payload.path,
              pos,
            });
            return;
        }
      },
    }),
    Placeholder.configure({
      placeholder: 'Start typing...',
    }),
    InlineTrigger.configure({
      triggers: getAllTriggers(),
      isMenuOpen: () => inlineMenuState.trigger !== null,
      onDismiss: () => inlineMenuState.closeInlineMenu(),
      onTrigger: (editor, trigger, from, coords) => {
        inlineMenuState.trigger = trigger;
        inlineMenuState.editor = ref(editor);
        inlineMenuState.from = from;
        inlineMenuState.coords = coords;
      },
    }),
    Collaboration.configure({
      document: doc,
    }),
    YUndoCursorFix,
  ] satisfies Extensions;

  const editor = new Editor({
    extensions,
    onUpdate: ({ editor }) => {
      saveContent(editor);
    },
  });

  editor.on('destroy', () => {
    persistence?.destroy();
    doc.destroy();
  });

  // Load any previously persisted state first, then seed from the on-disk
  // markdown only when this file has no editor history yet (first open).
  // Seeding emits no update so it neither re-writes the source file nor
  // requires the project to be the current one yet.
  if (persistence) {
    await persistence.whenSynced;
  }
  if (doc.getXmlFragment('default').length === 0) {
    const markdown = (await initialFile?.text())?.trim();
    if (markdown) {
      editor.commands.setContent(markdown, {
        contentType: 'markdown',
        emitUpdate: false,
      });
    }
  }

  return editor;
}
