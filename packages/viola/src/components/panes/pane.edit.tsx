import { lazy, Suspense } from 'react';
import { useSnapshot } from 'valtio';

import { Button } from '@v/ui/button';
import { Code, Loader2, Type } from '@v/ui/icon';
import { m } from '../../generated/paraglide/messages';
import { $content, $ui } from '../../stores/accessors';
import type { ContentId } from '../../stores/proxies/content';
import type { PaneId } from '../../stores/proxies/ui';
import { createPane, ScrollOverflow } from './util';

export type EditorMode = 'visual' | 'source';

type EditPaneProperty = { contentId: ContentId; mode?: EditorMode };

declare global {
  interface PanePropertyMap {
    edit: EditPaneProperty;
  }
}

export const Pane = createPane<EditPaneProperty>({
  title: Title,
  content: (props) => (
    <ScrollOverflow>
      <ModeToggle {...props} />
      <Suspense
        fallback={
          <div className="grid size-full place-items-center">
            <Loader2 className="animate-spin size-12 text-gray-300" />
          </div>
        }
      >
        <Content {...props} />
      </Suspense>
    </ScrollOverflow>
  ),
});

const ContentEditor = lazy(() => import('../content-editor'));
const SourceEditor = lazy(() => import('../source-editor'));

function Title({ contentId }: EditPaneProperty) {
  const content = useSnapshot($content).value();
  const file = content?.files.get(contentId);
  return file
    ? m.edit_pane_title_with_file({ filename: file.filename })
    : m.edit_pane_title();
}

function setMode(id: PaneId, mode: EditorMode) {
  const tab = $ui.tabs.find((t) => t.id === id);
  if (tab?.type === 'edit') {
    tab.mode = mode;
  }
}

function ModeToggle({
  id,
  mode = 'visual',
}: EditPaneProperty & { id?: PaneId }) {
  const isSource = mode === 'source';
  return (
    <div className="sticky top-0 z-10 flex justify-end bg-background p-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => id && setMode(id, isSource ? 'visual' : 'source')}
      >
        {isSource ? <Type /> : <Code />}
        {isSource ? m.edit_mode_visual() : m.edit_mode_source()}
      </Button>
    </div>
  );
}

function Content({ contentId, mode = 'visual' }: EditPaneProperty) {
  return mode === 'source' ? (
    <SourceEditor contentId={contentId} />
  ) : (
    <ContentEditor contentId={contentId} />
  );
}
