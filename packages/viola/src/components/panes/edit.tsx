import { lazy } from 'react';
import type { ContentId } from '../../stores/content';
import { $project } from '../../stores/project';

const ContentEditor = lazy(() =>
  $project.setupPromise.then(() => import('../content-editor')),
);

export function Edit({ contentId }: { contentId: ContentId }) {
  return <ContentEditor contentId={contentId} />;
}
