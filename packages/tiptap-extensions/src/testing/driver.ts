import type { Editor } from '@tiptap/core';

import type { Step } from './steps';

export type DriverName = 'node' | 'browser';

/** Applies a case's steps to an editor in one environment. */
export interface EditorDriver {
  readonly name: DriverName;
  readonly editor: Editor;
  supports(step: Step): boolean;
  perform(step: Step): Promise<void>;
  destroy(): void;
}

export type DriverFactory = () => EditorDriver | Promise<EditorDriver>;
