import { unstable_enableOp } from 'valtio';

import { startProjectRelay } from '../client/project-relay';

export function initStores(): () => void {
  // valtio 2.2+ requires opting into op delivery for `subscribe` callbacks;
  // `Sandbox` reads the ops to mirror file changes into storage and the CLI
  // worker's memfs.
  unstable_enableOp();
  const stopProjectRelay = startProjectRelay();
  return () => {
    stopProjectRelay();
    unstable_enableOp(false);
  };
}
