import { proxy } from 'valtio';

declare const paneIdBrand: unique symbol;
export type PaneId = string & { [paneIdBrand]: never };

export type PaneContent = {
  [K in keyof PanePropertyMap]: { type: K; id: PaneId } & PanePropertyMap[K];
}[keyof PanePropertyMap];

export const $ui = proxy({
  tabs: [] as PaneContent[],
  dedicatedModal: null as PaneContent | null,
});
