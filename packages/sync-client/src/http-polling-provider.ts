import * as Y from 'yjs';

import { BaseSyncProvider, type SyncTransport } from './types';

export interface HttpPollingSyncOptions {
  transport: SyncTransport;
  projectId: string;
  filename: string;
  doc: Y.Doc;
  /** Poll interval in milliseconds. */
  intervalMs?: number;
}

/**
 * Yjs sync over the HTTP fallback endpoint. Each round trip pushes any pending
 * local updates and pulls whatever the server has that the local document is
 * missing, in a single `POST /projects/:id/sync/:filename` call.
 */
export class HttpPollingSyncProvider extends BaseSyncProvider {
  private readonly transport: SyncTransport;
  private readonly projectId: string;
  private readonly filename: string;
  private readonly doc: Y.Doc;
  private readonly intervalMs: number;
  private readonly origin = Symbol('http-polling');
  private pending: Uint8Array[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(options: HttpPollingSyncOptions) {
    super();
    this.transport = options.transport;
    this.projectId = options.projectId;
    this.filename = options.filename;
    this.doc = options.doc;
    this.intervalMs = options.intervalMs ?? 5000;
  }

  private readonly handleUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== this.origin) {
      this.pending.push(update);
    }
  };

  async connect(): Promise<void> {
    this.setStatus('connecting');
    this.doc.on('update', this.handleUpdate);
    // Seed with the full current state so content created before connecting is
    // pushed to the server on the first exchange.
    this.pending.push(Y.encodeStateAsUpdate(this.doc));
    await this.sync();
    this.timer = setInterval(() => {
      void this.sync();
    }, this.intervalMs);
  }

  /** Run one bidirectional exchange. Exposed so callers can force a flush. */
  async sync(): Promise<void> {
    const stateVector = Y.encodeStateVector(this.doc);
    const localUpdate = this.pending.length
      ? Y.mergeUpdates(this.pending)
      : new Uint8Array();
    this.pending = [];
    try {
      const diff = await this.transport.syncPush(
        this.projectId,
        this.filename,
        localUpdate,
        stateVector,
      );
      if (diff.byteLength > 0) {
        Y.applyUpdate(this.doc, diff, this.origin);
      }
      this.setStatus('connected');
    } catch (error) {
      // Preserve unsent local changes for the next attempt.
      if (localUpdate.byteLength > 0) {
        this.pending.unshift(localUpdate);
      }
      this.setStatus('error');
      throw error;
    }
  }

  disconnect(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.doc.off('update', this.handleUpdate);
    this.setStatus('disconnected');
  }
}
