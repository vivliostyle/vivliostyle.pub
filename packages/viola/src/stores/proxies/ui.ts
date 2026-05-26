import { proxy } from 'valtio';
import { subscribeKey } from 'valtio/utils';

declare const paneIdBrand: unique symbol;
export type PaneId = string & { [paneIdBrand]: never };

export type PaneContent = {
  [K in keyof PanePropertyMap]: { type: K; id: PaneId } & PanePropertyMap[K];
}[keyof PanePropertyMap];

export const ui = proxy({
  tabs: [] as PaneContent[],
  dedicatedModal: null as PaneContent | null,
});

// The Open Project modal opens without going through a route transition,
// so beforeLoad-driven refreshes don't fire. Re-discover whenever it appears.
// Dynamic import sidesteps the cycle through `accessors` → `proxies/ui`.
subscribeKey(ui, 'dedicatedModal', async (modal) => {
  if (modal?.type !== 'start') return;
  const { discoverProjects } = await import('../actions/discover-projects');
  discoverProjects().catch(() => {});
});
