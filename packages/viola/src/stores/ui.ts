import { proxy } from 'valtio';
import type { ContentId } from './content';

declare const tabIdBrand: unique symbol;
export type TabId = string & { [tabIdBrand]: never };

export type TabContent = { id: TabId } & (
  | { type: 'editor'; contentId: ContentId }
  | { type: 'preview' }
);

export const ui = proxy({
  tabs: [] as TabContent[],
});
