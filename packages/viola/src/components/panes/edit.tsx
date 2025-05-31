import type { ContentId } from '../../stores/content';
import { ContentEditor } from '../content-editor';

export function Edit({ contentId }: { contentId: ContentId }) {
  return <ContentEditor contentId={contentId} />;
}
