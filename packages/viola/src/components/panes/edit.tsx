import { lazy } from 'react';
import { setupProjectPromise } from '../../actions';
import type { ContentId } from '../../stores/content';

const ContentEditor = lazy(() =>
  setupProjectPromise.then(() => import('../content-editor')),
);

export function Edit({ contentId }: { contentId: ContentId }) {
  return <ContentEditor contentId={contentId} />;
}
