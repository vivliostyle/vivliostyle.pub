import * as Y from 'yjs';

import type { ApiClient } from '@v/api-client';
import type { AuthClient } from '@v/auth-client';
import {
  type ConnectionStatus,
  HttpPollingSyncProvider,
  type SyncProvider,
  WebSocketSyncProvider,
} from '@v/sync-client';
import type { ProjectId } from '../stores/proxies/project';

export interface EditorSyncContext {
  api: ApiClient;
  auth: AuthClient;
  webSocketImpl?: typeof WebSocket;
}

export async function startEditorSync({
  doc,
  sync,
  projectId,
  filename,
}: {
  doc: Y.Doc;
  sync: EditorSyncContext;
  projectId: ProjectId;
  filename: string;
}): Promise<SyncProvider | undefined> {
  // Pull the server's state first so we don't re-seed an existing doc from
  // local markdown on top of whatever collaborators have already written.
  try {
    const stateVector = Y.encodeStateVector(doc);
    const diff = await sync.api.syncPush(
      projectId,
      filename,
      new Uint8Array(),
      stateVector,
    );
    if (diff.byteLength > 0) {
      Y.applyUpdate(doc, diff);
    }
  } catch {
    // Initial sync is best-effort; live providers below will keep retrying.
  }

  const ws = new WebSocketSyncProvider({
    url: async () => {
      const token = await sync.auth.getAccessToken();
      if (!token) {
        throw new Error('Not authenticated; cannot open sync WebSocket');
      }
      return sync.api.syncWebSocketUrl(projectId, filename, token);
    },
    doc,
    WebSocketImpl: sync.webSocketImpl,
  });
  let active: SyncProvider = ws;
  // Listeners are registered against the wrapper, not the underlying
  // provider, so they keep receiving status updates after the WS→polling
  // swap. Without this indirection, listeners attached pre-swap would stay
  // bound to the disconnected `ws` and miss every status change from the
  // polling provider.
  const listeners = new Set<(status: ConnectionStatus) => void>();
  const forward = (status: ConnectionStatus) => {
    for (const listener of listeners) {
      listener(status);
    }
  };
  let unsubscribeActive = active.onStatusChange(forward);
  let fallbackStarted = false;
  const wsUnsubscribe = ws.onStatusChange((status) => {
    if (status !== 'error' || fallbackStarted) {
      return;
    }
    fallbackStarted = true;
    wsUnsubscribe();
    unsubscribeActive();
    ws.disconnect();
    const polling = new HttpPollingSyncProvider({
      transport: sync.api,
      projectId,
      filename,
      doc,
    });
    active = polling;
    unsubscribeActive = polling.onStatusChange(forward);
    void polling.connect().catch(() => {
      // Polling provider retains pending updates internally and the interval
      // timer keeps retrying; nothing actionable to do here.
    });
  });
  try {
    await ws.connect();
  } catch {
    // Either provider keeps trying in the background; surface nothing here.
  }
  return {
    get status() {
      return active.status;
    },
    connect: () => active.connect(),
    disconnect: () => active.disconnect(),
    onStatusChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
