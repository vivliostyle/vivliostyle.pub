import type { Extensions } from '@tiptap/core';
import type { EditorProps } from '@tiptap/pm/view';

import type { ClipboardData, EditorDriver } from './driver';
import { createNodeDriver } from './node-driver';
import type { Step } from './steps';

const CLIPBOARD_STEPS = new Set<Step['kind']>(['copy', 'cut', 'paste']);

/**
 * Drives an editor mounted in a DOM that a test environment such as
 * happy-dom gives Node: the node driver's steps, and the clipboard. Copying,
 * cutting and pasting dispatch the events the browser would to the view's
 * own handlers, which write and read the clipboard's HTML. What the browser
 * does to that HTML on the way, and layout, are not there.
 */
export function createDomDriver(
  extensions: Extensions,
  editorProps: EditorProps = {},
): EditorDriver {
  const element = document.createElement('div');
  document.body.append(element);
  const driver = createNodeDriver(extensions, editorProps, element);
  const { editor } = driver;
  let clipboard: ClipboardData | null = null;

  function dispatch(type: 'copy' | 'cut' | 'paste', data: DataTransfer): void {
    editor.view.dom.dispatchEvent(
      new ClipboardEvent(type, {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  function paste(pasted: ClipboardData): void {
    const data = new DataTransfer();
    if (pasted.html) {
      data.setData('text/html', pasted.html);
    }
    if (pasted.text) {
      data.setData('text/plain', pasted.text);
    }
    dispatch('paste', data);
  }

  return {
    ...driver,
    name: 'dom',
    clipboard: () => clipboard,
    supports(step: Step) {
      return driver.supports(step) || CLIPBOARD_STEPS.has(step.kind);
    },
    async perform(step: Step) {
      switch (step.kind) {
        case 'copy':
        case 'cut': {
          const data = new DataTransfer();
          dispatch(step.kind, data);
          // As in the browser, copying nothing leaves the clipboard as it was.
          if (data.types.length > 0) {
            clipboard = {
              html: data.getData('text/html'),
              text: data.getData('text/plain'),
            };
          }
          return;
        }
        case 'paste':
          if (step.html !== undefined || step.text !== undefined) {
            paste({ html: step.html ?? '', text: step.text ?? '' });
          } else if (clipboard) {
            paste(clipboard);
          } else {
            throw new Error('Nothing was copied to paste');
          }
          return;
        default:
          return driver.perform(step);
      }
    },
    destroy() {
      driver.destroy();
      element.remove();
    },
  };
}
