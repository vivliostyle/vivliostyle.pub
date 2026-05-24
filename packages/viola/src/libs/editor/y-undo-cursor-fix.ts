import { Extension } from '@tiptap/core';
import {
  type ProsemirrorBinding,
  ySyncPluginKey,
  yUndoPluginKey,
} from '@tiptap/y-tiptap';
import type * as Y from 'yjs';

// Restores the cursor at the right offset across Yjs undo/redo.
//
// Two issues in y-prosemirror's bundled cursor-restore make undo/redo land at
// the wrong place:
//
// 1. The popped stack item's stored selection is loaded into
//    `binding.beforeTransactionSelection` from a `stack-item-popped` listener,
//    but that event fires *after* `cleanupTransactions` has already run the
//    sync plugin's observer — so the observer dispatches with the previous
//    operation's stored selection. We pre-load the correct value on
//    `beforeObserverCalls` (which runs before observers, while
//    `undoManager.currStackItem` is already set).
//
// 2. The inverse-direction stack item (the redo item created during an undo,
//    or vice versa) is supposed to remember the *current* cursor so the next
//    undo/redo can put the caret back there. y-prosemirror tries to capture
//    that from `plugin.apply` running on the sync plugin's own dispatched
//    transaction — but by then the Yjs items the cursor pointed at have
//    already been deleted, so `absolutePositionToRelativePosition` falls back
//    to `{ item: null, tname: 'default' }` (i.e. position 0). The fragment-
//    level fallback can't be resolved back to a real offset, so the next
//    redo/undo lands at the start. We instead snapshot the binding's *prior*
//    `beforeTransactionSelection` (set by the last `_prosemirrorChanged`
//    while the items still existed) inside `beforeObserverCalls` and
//    overwrite the just-created inverse-stack item's meta after y-prosemirror
//    has stored its (wrong) value.
type RelativeSelection = ProsemirrorBinding['beforeTransactionSelection'];
type BindingWithDoc = ProsemirrorBinding & { doc: Y.Doc };

export const YUndoCursorFix = Extension.create({
  name: 'yUndoCursorFix',

  onCreate() {
    const editor = this.editor;
    const ystate = ySyncPluginKey.getState(editor.state) as
      | { binding: BindingWithDoc | null }
      | undefined;
    const undoState = yUndoPluginKey.getState(editor.state) as
      | { undoManager: Y.UndoManager }
      | undefined;
    const binding = ystate?.binding;
    const undoManager = undoState?.undoManager;
    if (!binding || !undoManager) {
      return;
    }
    const doc = binding.doc;

    let pendingInverseSelection: RelativeSelection | null = null;

    const onBeforeObservers = (transaction: Y.Transaction) => {
      if (transaction.origin !== undoManager) return;
      const stackItem = undoManager.currStackItem;
      if (!stackItem) return;

      // Snapshot the pre-undo/redo cursor before we overwrite it. This is
      // anchored to Yjs items that have been logically deleted but are
      // still present (with their original IDs and a `.redone` link), so
      // the relative position resolves back to the right offset on the
      // inverse operation.
      pendingInverseSelection = binding.beforeTransactionSelection;

      const sel = stackItem.meta.get(binding) as RelativeSelection | undefined;
      if (sel) {
        binding.beforeTransactionSelection = sel;
      }
    };

    const onStackItemAdded = ({
      stackItem,
    }: {
      stackItem: { meta: Map<unknown, unknown> };
    }) => {
      if (pendingInverseSelection !== null) {
        stackItem.meta.set(binding, pendingInverseSelection);
        pendingInverseSelection = null;
      }
    };

    doc.on('beforeObserverCalls', onBeforeObservers);
    undoManager.on('stack-item-added', onStackItemAdded);
    (this.storage as { cleanup?: () => void }).cleanup = () => {
      doc.off('beforeObserverCalls', onBeforeObservers);
      undoManager.off('stack-item-added', onStackItemAdded);
    };
  },

  onDestroy() {
    (this.storage as { cleanup?: () => void }).cleanup?.();
  },
});
