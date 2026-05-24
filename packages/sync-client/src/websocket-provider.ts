import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import type * as Y from 'yjs';

import { BaseSyncProvider } from './types';

const MESSAGE_SYNC = 0;
const WS_OPEN = 1;

export interface WebSocketSyncOptions {
  /** WebSocket URL, or a resolver (e.g. to attach a fresh access token). */
  url: string | (() => string | Promise<string>);
  doc: Y.Doc;
  WebSocketImpl?: typeof WebSocket;
}

/**
 * Realtime Yjs sync over a WebSocket using the y-protocols sync messages, the
 * same protocol the reference server speaks. Updates flow in both directions;
 * the document is the single source of truth on the client.
 */
export class WebSocketSyncProvider extends BaseSyncProvider {
  private readonly doc: Y.Doc;
  private readonly resolveUrl: () => string | Promise<string>;
  private readonly WebSocketImpl: typeof WebSocket;
  private readonly origin = Symbol('websocket');
  private ws: WebSocket | undefined;
  private disposed = false;

  constructor(options: WebSocketSyncOptions) {
    super();
    this.doc = options.doc;
    this.resolveUrl =
      typeof options.url === 'function'
        ? options.url
        : () => options.url as string;
    this.WebSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket;
  }

  private send(message: Uint8Array): void {
    if (this.ws && this.ws.readyState === WS_OPEN) {
      const buffer = new ArrayBuffer(message.byteLength);
      new Uint8Array(buffer).set(message);
      this.ws.send(buffer);
    }
  }

  private readonly handleUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this.origin) {
      return;
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  };

  private handleMessage(data: unknown): void {
    if (typeof data === 'string' || !this.ws) {
      return;
    }
    const bytes = new Uint8Array(data as ArrayBuffer);
    const decoder = decoding.createDecoder(bytes);
    const messageType = decoding.readVarUint(decoder);
    if (messageType !== MESSAGE_SYNC) {
      return;
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.readSyncMessage(decoder, encoder, this.doc, this.origin);
    if (encoding.length(encoder) > 1) {
      this.send(encoding.toUint8Array(encoder));
    }
  }

  async connect(): Promise<void> {
    this.disposed = false;
    this.setStatus('connecting');
    const url = await this.resolveUrl();
    if (this.disposed) {
      return;
    }
    const ws = new this.WebSocketImpl(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.doc.on('update', this.handleUpdate);

    ws.addEventListener('open', () => {
      this.setStatus('connected');
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, this.doc);
      this.send(encoding.toUint8Array(encoder));
    });
    ws.addEventListener('message', (event) => {
      this.handleMessage(event.data);
    });
    ws.addEventListener('close', () => {
      if (!this.disposed) {
        this.setStatus('disconnected');
      }
    });
    ws.addEventListener('error', () => {
      this.setStatus('error');
    });
  }

  disconnect(): void {
    this.disposed = true;
    this.doc.off('update', this.handleUpdate);
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
    this.setStatus('disconnected');
  }
}
