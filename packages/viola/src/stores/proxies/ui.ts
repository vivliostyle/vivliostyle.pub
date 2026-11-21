import { proxy } from 'valtio';

import { generateId } from '../../libs/generate-id';

declare const paneIdBrand: unique symbol;
export type PaneId = string & { [paneIdBrand]: never };

export type PaneContent = {
  [K in keyof PanePropertyMap]: { type: K; id: PaneId } & PanePropertyMap[K];
}[keyof PanePropertyMap];

export type PaneInit = {
  [K in keyof PanePropertyMap]: { type: K } & PanePropertyMap[K];
}[keyof PanePropertyMap];

function withId(pane: PaneInit): PaneContent {
  return { ...pane, id: generateId<PaneId>() } as PaneContent;
}

function isSamePane(tab: PaneContent, pane: PaneInit): boolean {
  if (tab.type === 'edit' && pane.type === 'edit') {
    return tab.contentId === pane.contentId;
  }
  if (tab.type === 'extension' && pane.type === 'extension') {
    return (
      tab.extensionId === pane.extensionId && tab.panePath === pane.panePath
    );
  }
  return tab.type === pane.type;
}

// A pane shown beside the editor sits next to the preview instead when the
// preview is what the user is looking at.
function isMainPane(tab: PaneContent): boolean {
  return (
    tab.type === 'edit' ||
    (tab.type === 'extension' && tab.extensionId === 'preview')
  );
}

// Arrow functions that name `ui` rather than `this`: called on a snapshot,
// `this` is the read-only snapshot and the write would throw.
export const ui = proxy({
  tabs: [] as PaneContent[],
  dedicatedModal: null as PaneContent | null,

  showPane: (
    pane: PaneInit,
    {
      besideEditor = false,
      keepIfShown = false,
    }: {
      besideEditor?: boolean;
      // Leave the panes untouched while one already shows this content, so its
      // state (an editor's mode, an extension frame) survives the navigation.
      // A predicate decides instead which open pane counts as showing it.
      keepIfShown?: boolean | ((tab: PaneContent) => boolean);
    } = {},
  ): void => {
    const isShown =
      typeof keepIfShown === 'function'
        ? keepIfShown
        : (tab: PaneContent) => keepIfShown && isSamePane(tab, pane);
    if (ui.tabs.some(isShown)) {
      return;
    }
    const main = besideEditor
      ? ui.tabs
          .filter((tab) => isMainPane(tab) && tab.type !== pane.type)
          .slice(0, 1)
      : [];
    ui.tabs = [...main, withId(pane)];
  },

  closePanes: (predicate: (tab: PaneContent) => boolean): void => {
    ui.tabs = ui.tabs.filter((tab) => !predicate(tab));
  },

  setEditMode: (
    paneId: PaneId,
    mode: NonNullable<PanePropertyMap['edit']['mode']>,
  ): void => {
    const tab = ui.tabs.find((t) => t.id === paneId);
    if (tab?.type === 'edit') {
      tab.mode = mode;
    }
  },

  openModal: (pane: PaneInit): void => {
    ui.dedicatedModal = withId(pane);
  },

  closeModal: (): void => {
    ui.dedicatedModal = null;
  },
});
