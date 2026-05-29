import { lazy } from 'react';
import { useSnapshot } from 'valtio';

import { Tabs, TabsList, TabsTrigger } from '@v/ui/tabs';
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
      <Content {...props} />
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
  return (
    <div className="sticky top-0 z-10 flex justify-end bg-background p-2">
      <Tabs
        value={mode}
        onValueChange={(value) => id && setMode(id, value as EditorMode)}
      >
        <TabsList aria-label={m.edit_mode_toggle_aria()}>
          <TabsTrigger value="visual">{m.edit_mode_visual()}</TabsTrigger>
          <TabsTrigger value="source">{m.edit_mode_source()}</TabsTrigger>
        </TabsList>
      </Tabs>
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
