import { proxy } from 'valtio';
import type { ContentId } from './content';

declare const paneIdBrand: unique symbol;
export type PaneId = string & { [paneIdBrand]: never };

export type PaneContent = { id: PaneId; title: () => React.ReactNode } & (
  | { type: 'edit'; contentId: ContentId }
  | { type: 'preview' }
  | { type: 'theme' }
  | { type: 'settings' }
);

export const ui = proxy({
  tabs: [] as PaneContent[],
  dedicatedModal: null as PaneContent | null,
});
