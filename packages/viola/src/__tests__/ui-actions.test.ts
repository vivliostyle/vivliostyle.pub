import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../stores/actions/discover-projects', () => ({
  discoverProjects: vi.fn().mockResolvedValue(undefined),
}));

import { generateId } from '../libs/generate-id';
import { $ui } from '../stores/accessors';
import { discoverProjects } from '../stores/actions/discover-projects';
import {
  closeModal,
  closePanes,
  openModal,
  openProjectsModal,
  setEditMode,
  showPane,
} from '../stores/actions/ui';
import type { ContentId } from '../stores/proxies/content';
import type { ExtensionId } from '../stores/proxies/extension';
import type { PaneId } from '../stores/proxies/ui';

const contentA = 'content-a' as ContentId;
const contentB = 'content-b' as ContentId;
const preview = {
  type: 'extension',
  extensionId: 'preview' as ExtensionId,
  panePath: '.',
} as const;

const types = () => $ui.tabs.map((tab) => tab.type);

describe('ui actions', () => {
  beforeEach(() => {
    $ui.tabs = [];
    $ui.dedicatedModal = null;
    vi.mocked(discoverProjects).mockClear();
  });

  describe('showPane', () => {
    it('replaces every pane by default', () => {
      showPane({ type: 'edit', contentId: contentA });
      showPane({ type: 'bibliography' }, { besideEditor: true });

      showPane({ type: 'start' });

      expect(types()).toEqual(['start']);
    });

    it('keeps only the first editor when shown beside it', () => {
      showPane({ type: 'edit', contentId: contentA });
      $ui.tabs.push({
        id: generateId<PaneId>(),
        type: 'edit',
        contentId: contentB,
      });
      showPane({ type: 'theme' }, { besideEditor: true });

      showPane({ type: 'media' }, { besideEditor: true });

      expect($ui.tabs).toMatchObject([
        { type: 'edit', contentId: contentA },
        { type: 'media' },
      ]);
    });

    it('opens a fresh pane each time unless asked to keep it', () => {
      showPane({ type: 'bibliography' });
      const firstId = $ui.tabs[0].id;

      showPane({ type: 'bibliography' });

      expect($ui.tabs[0].id).not.toBe(firstId);
    });

    it('leaves the panes alone while the same content is shown', () => {
      showPane({ type: 'edit', contentId: contentA });
      setEditMode($ui.tabs[0].id, 'source');
      showPane({ type: 'bibliography' }, { besideEditor: true });
      const before = $ui.tabs;

      showPane({ type: 'edit', contentId: contentA }, { keepIfShown: true });

      expect($ui.tabs).toBe(before);
      expect($ui.tabs[0]).toMatchObject({ mode: 'source' });
    });

    it('tells editors apart by content and extensions by pane', () => {
      showPane({ type: 'edit', contentId: contentA });
      showPane({ type: 'edit', contentId: contentB }, { keepIfShown: true });
      expect($ui.tabs).toMatchObject([{ contentId: contentB }]);

      showPane(preview);
      showPane({ ...preview, panePath: '/other' }, { keepIfShown: true });
      expect($ui.tabs).toMatchObject([{ panePath: '/other' }]);
    });
  });

  it('closePanes drops the matching panes only', () => {
    showPane({ type: 'edit', contentId: contentA });
    showPane(preview, { besideEditor: true });

    closePanes((tab) => tab.type === 'extension');

    expect(types()).toEqual(['edit']);
  });

  it('setEditMode ignores panes that are not editors', () => {
    showPane({ type: 'theme' });

    setEditMode($ui.tabs[0].id, 'source');

    expect($ui.tabs[0]).not.toHaveProperty('mode');
  });

  it('openModal and closeModal toggle the dedicated modal', () => {
    openModal(preview);
    expect($ui.dedicatedModal).toMatchObject(preview);
    expect($ui.dedicatedModal?.id).toBeTruthy();

    closeModal();
    expect($ui.dedicatedModal).toBeNull();
  });

  it('openProjectsModal refreshes the project list', () => {
    openProjectsModal();

    expect($ui.dedicatedModal?.type).toBe('start');
    expect(discoverProjects).toHaveBeenCalledOnce();
  });
});
