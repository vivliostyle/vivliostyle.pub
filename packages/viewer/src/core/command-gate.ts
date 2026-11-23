/** Core's action names, as its `done` event reports them. */
export type CoreAction = 'loadPublication' | 'configure' | 'moveTo';

export interface CoreCommandPayload {
  a?: unknown;
  content?: { messages?: unknown[] } | null;
}

export interface CoreCommandEvents {
  addListener(
    type: 'done' | 'error',
    listener: (payload: CoreCommandPayload) => void,
  ): void;
}

export interface GateOptions {
  /**
   * A queued command with the same key is dropped in favour of this one, so a
   * burst of the same request runs once with the latest arguments.
   */
  key?: string;
}

interface Entry {
  action: CoreAction;
  issue: () => void;
  key: string | undefined;
  settle: (ran: boolean) => void;
}

// What core logs when an action throws; it then skips the `done` event.
const actionFailedMessage = 'Error during action:';

/**
 * Serializes the commands sent to one core viewer: core holds one pending
 * command and silently drops a second one sent before it picks up the first.
 */
export class CommandGate {
  readonly #queue: Entry[] = [];
  #inFlight: Entry | null = null;

  constructor(events: CoreCommandEvents) {
    events.addListener('done', ({ a }) => {
      if (a === this.#inFlight?.action) {
        this.#finish();
      }
    });
    events.addListener('error', ({ content }) => {
      const messages = content?.messages;
      if (
        this.#inFlight &&
        Array.isArray(messages) &&
        messages.includes(actionFailedMessage) &&
        messages.at(-1) === this.#inFlight.action
      ) {
        this.#finish();
      }
    });
  }

  /**
   * Runs `issue`, which sends one `action` command, after the commands queued
   * before it. Resolves with true once core is done with it (or reported it
   * failed), false if a newer one with the same key replaced it or it threw.
   */
  run(
    action: CoreAction,
    issue: () => void,
    options: GateOptions = {},
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const entry: Entry = { action, issue, key: options.key, settle: resolve };
      const replaced =
        entry.key === undefined
          ? -1
          : this.#queue.findIndex((queued) => queued.key === entry.key);
      if (replaced < 0) {
        this.#queue.push(entry);
      } else {
        this.#queue[replaced].settle(false);
        this.#queue[replaced] = entry;
      }
      this.#pump();
    });
  }

  /** True while a command is with core or waiting for its turn. */
  get busy(): boolean {
    return this.#inFlight !== null || this.#queue.length > 0;
  }

  #pump() {
    while (!this.#inFlight) {
      const entry = this.#queue.shift();
      if (!entry) {
        return;
      }
      this.#inFlight = entry;
      try {
        entry.issue();
      } catch (error) {
        console.error(error);
        if (this.#inFlight === entry) {
          this.#inFlight = null;
        }
        entry.settle(false);
      }
    }
  }

  #finish() {
    const entry = this.#inFlight;
    this.#inFlight = null;
    // Core reports `done` before its command loop moves on, and the loop
    // takes a command sent from here ahead of the layout task the finished
    // command scheduled, which the new one then cannot cancel. Once the
    // callback has returned, the loop waits and a command queues behind it.
    queueMicrotask(() => this.#pump());
    entry?.settle(true);
  }
}
