import { snapshot } from 'valtio';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../stores/actions/discover-projects', () => ({
  discoverProjects: vi.fn().mockResolvedValue(undefined),
}));

import { generateId } from '../libs/generate-id';
import { $ui } from '../stores/accessors';
import { discoverProjects } from '../stores/actions/discover-projects';
import { openProjectsModal } from '../stores/actions/ui';
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

describe('ui', () => {
  beforeEach(() => {
    $ui.tabs = [];
    $ui.dedicatedModal = null;
    vi.mocked(discoverProjects).mockClear();
  });

  describe('$ui.showPane', () => {
    it('replaces every pane by default', () => {
      $ui.showPane({ type: 'edit', contentId: contentA });
      $ui.showPane({ type: 'bibliography' }, { besideEditor: true });

      $ui.showPane({ type: 'start' });

      expect(types()).toEqual(['start']);
    });

    it('keeps only the first editor when shown beside it', () => {
      $ui.showPane({ type: 'edit', contentId: contentA });
      $ui.tabs.push({
        id: generateId<PaneId>(),
        type: 'edit',
        contentId: contentB,
      });
      $ui.showPane({ type: 'theme' }, { besideEditor: true });

      $ui.showPane({ type: 'media' }, { besideEditor: true });

      expect($ui.tabs).toMatchObject([
        { type: 'edit', contentId: contentA },
        { type: 'media' },
      ]);
    });

    it('keeps the preview when shown beside it', () => {
      $ui.showPane(preview);
      $ui.showPane({ type: 'theme' }, { besideEditor: true });

      $ui.showPane({ type: 'media' }, { besideEditor: true });

      expect($ui.tabs).toMatchObject([
        { type: 'extension', extensionId: 'preview' },
        { type: 'media' },
      ]);
    });

    it('does not stack an extension pane beside the preview', () => {
      $ui.showPane(preview);

      $ui.showPane({ ...preview, panePath: '/other' }, { besideEditor: true });

      expect($ui.tabs).toMatchObject([{ panePath: '/other' }]);
    });

    it('opens a fresh pane each time unless asked to keep it', () => {
      $ui.showPane({ type: 'bibliography' });
      const firstId = $ui.tabs[0].id;

      $ui.showPane({ type: 'bibliography' });

      expect($ui.tabs[0].id).not.toBe(firstId);
    });

    it('leaves the panes alone while the same content is shown', () => {
      $ui.showPane({ type: 'edit', contentId: contentA });
      $ui.setEditMode($ui.tabs[0].id, 'source');
      $ui.showPane({ type: 'bibliography' }, { besideEditor: true });
      const before = $ui.tabs;

      $ui.showPane(
        { type: 'edit', contentId: contentA },
        { keepIfShown: true },
      );

      expect($ui.tabs).toBe(before);
      expect($ui.tabs[0]).toMatchObject({ mode: 'source' });
    });

    it('tells editors apart by content and extensions by pane', () => {
      $ui.showPane({ type: 'edit', contentId: contentA });
      $ui.showPane(
        { type: 'edit', contentId: contentB },
        { keepIfShown: true },
      );
      expect($ui.tabs).toMatchObject([{ contentId: contentB }]);

      $ui.showPane(preview);
      $ui.showPane({ ...preview, panePath: '/other' }, { keepIfShown: true });
      expect($ui.tabs).toMatchObject([{ panePath: '/other' }]);
    });

    it('keeps any pane that the predicate accepts', () => {
      $ui.showPane({ ...preview, panePath: '/other' });
      const before = $ui.tabs;

      $ui.showPane(preview, {
        keepIfShown: (tab) =>
          tab.type === 'extension' && tab.extensionId === preview.extensionId,
      });

      expect($ui.tabs).toBe(before);
    });
  });

  // A method written with `this` would throw here: the snapshot is read-only.
  it('writes to the proxy even when called on a snapshot', () => {
    snapshot($ui).showPane({ type: 'theme' });

    expect(types()).toEqual(['theme']);
  });

  it('$ui.closePanes drops the matching panes only', () => {
    $ui.showPane({ type: 'edit', contentId: contentA });
    $ui.showPane(preview, { besideEditor: true });

    $ui.closePanes((tab) => tab.type === 'extension');

    expect(types()).toEqual(['edit']);
  });

  it('$ui.setEditMode ignores panes that are not editors', () => {
    $ui.showPane({ type: 'theme' });

    $ui.setEditMode($ui.tabs[0].id, 'source');

    expect($ui.tabs[0]).not.toHaveProperty('mode');
  });

  it('$ui.openModal and $ui.closeModal toggle the dedicated modal', () => {
    $ui.openModal(preview);
    expect($ui.dedicatedModal).toMatchObject(preview);
    expect($ui.dedicatedModal?.id).toBeTruthy();

    $ui.closeModal();
    expect($ui.dedicatedModal).toBeNull();
  });

  it('openProjectsModal refreshes the project list', () => {
    openProjectsModal();

    expect($ui.dedicatedModal?.type).toBe('start');
    expect(discoverProjects).toHaveBeenCalledOnce();
  });
});
