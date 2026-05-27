import * as Y from 'yjs';

import type { ApiClient } from '@v/api-client';
import type { AuthClient } from '@v/auth-client';
import {
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
  let fallbackStarted = false;
  const unsubscribe = ws.onStatusChange((status) => {
    if (status !== 'error' || fallbackStarted) {
      return;
    }
    fallbackStarted = true;
    unsubscribe();
    ws.disconnect();
    const polling = new HttpPollingSyncProvider({
      transport: sync.api,
      projectId,
      filename,
      doc,
    });
    active = polling;
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
    onStatusChange: (listener) => active.onStatusChange(listener),
  };
}
