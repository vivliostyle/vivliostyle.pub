import { unstable_enableOp } from 'valtio';
import { subscribeKey } from 'valtio/utils';

import { startProjectRelay } from '../client/project-relay';
import { $ui } from './accessors';
import { discoverProjects } from './actions/discover-projects';

export function initStores(): () => void {
  // valtio 2.2+ requires opting into op delivery for `subscribe` callbacks;
  // `Sandbox` reads the ops to mirror file changes into storage and the CLI
  // worker's memfs.
  unstable_enableOp();
  const stopProjectRelay = startProjectRelay();
  // The Open Project modal opens without going through a route transition,
  // so beforeLoad-driven refreshes don't fire. Re-discover whenever it appears.
  const stopDiscoveringOnStartModal = subscribeKey(
    $ui,
    'dedicatedModal',
    (modal) => {
      if (modal?.type !== 'start') return;
      discoverProjects().catch((err) => {
        console.error('[ui] discoverProjects failed', err);
      });
    },
  );
  return () => {
    stopProjectRelay();
    stopDiscoveringOnStartModal();
    unstable_enableOp(false);
  };
}
