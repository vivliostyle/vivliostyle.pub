// y-prosemirror's sync plugin calls `view._root.createRange()` from its
// "is the local cursor in view?" check. When the ProseMirror editor lives
// inside a Shadow DOM (as it does here via EditorStyleContainer), `_root` is a
// ShadowRoot, which has no `createRange` method — `Document.createRange` is
// the standard API. The thrown TypeError aborts the post-undo `tr.dispatch`,
// leaving the editor visually out of sync with the underlying Yjs doc.
// Delegating to the owning document is the same range factory either way.
if (typeof ShadowRoot !== 'undefined') {
  const proto = ShadowRoot.prototype as ShadowRoot & {
    createRange?: () => Range;
  };
  if (typeof proto.createRange !== 'function') {
    proto.createRange = function createRange(this: ShadowRoot): Range {
      return (this.ownerDocument ?? document).createRange();
    };
  }
}
