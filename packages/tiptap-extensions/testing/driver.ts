import type { Editor } from '@tiptap/core';

import type { Step } from './steps';

export type DriverName = 'node' | 'dom' | 'browser';

export type BrowserEngine = 'chromium' | 'firefox' | 'webkit';

/** The environment a case runs in. */
export interface DriverTarget {
  readonly name: DriverName;
  /** The browser the editor runs in, for a driver named `browser`. */
  readonly engine?: BrowserEngine;
}

/**
 * Applies a case's steps to an editor in one environment. The case runs in
 * the same process or page as the editor: steps may carry functions, and the
 * results are read from the editor's state directly.
 */
export interface EditorDriver extends DriverTarget {
  readonly editor: Editor;
  /** What the last copy or cut put on the clipboard, for a driver that has one. */
  clipboard?(): ClipboardData | null;
  supports(step: Step): boolean;
  perform(step: Step): Promise<void>;
  destroy(): void;
}

/** The data of the clipboard by its MIME type. */
export interface ClipboardData {
  html: string;
  text: string;
}

/**
 * What `perform` throws for a step that turns out to need what the
 * environment lacks, such as the browser moving the caret. The case is
 * skipped.
 */
export class UnsupportedStep extends Error {}

export type DriverFactory = () => EditorDriver | Promise<EditorDriver>;
