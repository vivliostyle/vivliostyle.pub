export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export interface SyncProvider {
  readonly status: ConnectionStatus;
  connect(): Promise<void>;
  disconnect(): void;
  onStatusChange(listener: (status: ConnectionStatus) => void): () => void;
}

/** Minimal transport the HTTP polling provider needs (satisfied by ApiClient). */
export interface SyncTransport {
  syncPull(projectId: string, stateVector?: Uint8Array): Promise<Uint8Array>;
  syncPush(
    projectId: string,
    update: Uint8Array,
    stateVector?: Uint8Array,
  ): Promise<Uint8Array>;
}

export abstract class BaseSyncProvider implements SyncProvider {
  private _status: ConnectionStatus = 'disconnected';
  private readonly listeners = new Set<(status: ConnectionStatus) => void>();

  get status(): ConnectionStatus {
    return this._status;
  }

  protected setStatus(status: ConnectionStatus): void {
    if (status === this._status) {
      return;
    }
    this._status = status;
    for (const listener of this.listeners) {
      listener(status);
    }
  }

  onStatusChange(listener: (status: ConnectionStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): void;
}
