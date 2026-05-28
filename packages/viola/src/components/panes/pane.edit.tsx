import { lazy } from 'react';
import { useSnapshot } from 'valtio';

import { m } from '../../generated/paraglide/messages';
import { $content } from '../../stores/accessors';
import type { ContentId } from '../../stores/proxies/content';
import { createPane, ScrollOverflow } from './util';

type EditPaneProperty = { contentId: ContentId };

declare global {
  interface PanePropertyMap {
    edit: EditPaneProperty;
  }
}

export const Pane = createPane<EditPaneProperty>({
  title: Title,
  content: (props) => (
    <ScrollOverflow>
      <Content {...props} />
    </ScrollOverflow>
  ),
});

const ContentEditor = lazy(() => import('../content-editor'));

function Title({ contentId }: EditPaneProperty) {
  const content = useSnapshot($content).value();
  const file = content?.files.get(contentId);
  return file
    ? m.edit_pane_title_with_file({ filename: file.filename })
    : m.edit_pane_title();
}

function Content({ contentId }: EditPaneProperty) {
  return <ContentEditor contentId={contentId} />;
}
