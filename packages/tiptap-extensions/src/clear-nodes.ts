import { Extension } from '@tiptap/core';
import { liftTarget } from '@tiptap/pm/transform';

// Backports the chaining fix of ueberdosis/tiptap#8211 (@tiptap/core 3.32.3):
// the bundled clearNodes also maps positions through earlier commands' steps.
// Remove on upgrade; upstream additionally unwraps every nested list level.
export const ChainSafeClearNodes = Extension.create({
  name: 'chainSafeClearNodes',

  addCommands() {
    return {
      clearNodes:
        () =>
        ({ tr, dispatch }) => {
          if (!dispatch) {
            return true;
          }
          const doc = tr.doc;
          const startMaps = tr.mapping.maps.length;
          for (const { $from, $to } of tr.selection.ranges) {
            doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
              if (node.type.isText) {
                return;
              }
              const mapping = tr.mapping.slice(startMaps);
              const $mappedFrom = tr.doc.resolve(mapping.map(pos));
              const $mappedTo = tr.doc.resolve(
                mapping.map(pos + node.nodeSize),
              );
              const nodeRange = $mappedFrom.blockRange($mappedTo);
              if (!nodeRange) {
                return;
              }
              const targetLiftDepth = liftTarget(nodeRange);
              if (node.type.isTextblock) {
                const { defaultType } = $mappedFrom.parent.contentMatchAt(
                  $mappedFrom.index(),
                );
                tr.setNodeMarkup(nodeRange.start, defaultType);
              }
              if (targetLiftDepth !== null) {
                tr.lift(nodeRange, targetLiftDepth);
              }
            });
          }
          return true;
        },
    };
  },
});
