import { generateId } from '../../libs/generate-id';
import { $ui } from '../accessors';
import type { PaneContent, PaneId, PaneInit } from '../proxies/ui';
import { discoverProjects } from './discover-projects';

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

export function showPane(
  pane: PaneInit,
  {
    besideEditor = false,
    keepIfShown = false,
  }: {
    // Keep the first open editor and show the pane next to it.
    besideEditor?: boolean;
    // Leave the panes untouched while one already shows this content, so its
    // state (an editor's mode, an extension frame) survives the navigation.
    keepIfShown?: boolean;
  } = {},
): void {
  if (keepIfShown && $ui.tabs.some((tab) => isSamePane(tab, pane))) {
    return;
  }
  const editor = besideEditor
    ? $ui.tabs.filter((tab) => tab.type === 'edit').slice(0, 1)
    : [];
  $ui.tabs = [...editor, withId(pane)];
}

export function closePanes(predicate: (tab: PaneContent) => boolean): void {
  $ui.tabs = $ui.tabs.filter((tab) => !predicate(tab));
}

export function setEditMode(
  paneId: PaneId,
  mode: NonNullable<PanePropertyMap['edit']['mode']>,
): void {
  const tab = $ui.tabs.find((t) => t.id === paneId);
  if (tab?.type === 'edit') {
    tab.mode = mode;
  }
}

export function openModal(pane: PaneInit): void {
  $ui.dedicatedModal = withId(pane);
}

export function closeModal(): void {
  $ui.dedicatedModal = null;
}

// The modal opens without a route transition, so the discovery that the
// start route's beforeLoad runs never happens.
export function openProjectsModal(): void {
  openModal({ type: 'start' });
  discoverProjects().catch((err) => {
    console.error('[ui] discoverProjects failed', err);
  });
}
