import { lazy } from 'react';
import { useSnapshot } from 'valtio';

import { $content } from '../../stores/accessors';
import type { ContentId } from '../../stores/content';
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
  const content = useSnapshot($content).valueOrThrow;
  const file = content.files.get(contentId);
  return file ? `Content Editor: File ${file.filename}` : `Content Editor`;
}

function Content({ contentId }: EditPaneProperty) {
  return <ContentEditor contentId={contentId} />;
}
