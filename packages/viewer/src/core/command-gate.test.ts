import { describe, expect, it } from 'vitest';

import {
  CommandGate,
  type CoreAction,
  type CoreCommandEvents,
  type CoreCommandPayload,
} from './command-gate';

class FakeCore implements CoreCommandEvents {
  readonly issued: string[] = [];
  /** Whether core is calling its listeners, as it does from its command loop. */
  dispatching = false;
  readonly #listeners = new Map<string, ((p: CoreCommandPayload) => void)[]>();

  addListener(type: string, listener: (payload: CoreCommandPayload) => void) {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }

  emit(type: string, payload: CoreCommandPayload) {
    this.dispatching = true;
    try {
      for (const listener of this.#listeners.get(type) ?? []) {
        listener(payload);
      }
    } finally {
      this.dispatching = false;
    }
  }

  done(action: CoreAction) {
    this.emit('done', { a: action });
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve));

describe('CommandGate', () => {
  it('issues a command only after the previous one is done', async () => {
    const core = new FakeCore();
    const gate = new CommandGate(core);
    const first = gate.run('loadPublication', () => core.issued.push('load'));
    const second = gate.run('moveTo', () => core.issued.push('move'));
    expect(core.issued).toEqual(['load']);

    core.done('loadPublication');
    expect(await first).toBe(true);
    expect(core.issued).toEqual(['load', 'move']);

    core.done('moveTo');
    expect(await second).toBe(true);
    expect(gate.busy).toBe(false);
  });

  // Core's command loop takes a command sent while it reports `done` before
  // the layout task the finished command scheduled has started, so a
  // configure sent then cannot cancel a load's layout.
  it('sends the next command only after core has returned from `done`', async () => {
    const core = new FakeCore();
    const gate = new CommandGate(core);
    const sentWhileDispatching: boolean[] = [];
    void gate.run('loadPublication', () => core.issued.push('load'));
    void gate.run('configure', () => {
      sentWhileDispatching.push(core.dispatching);
      core.issued.push('configure');
    });

    core.done('loadPublication');
    expect(core.issued).toEqual(['load']);
    expect(gate.busy).toBe(true);

    await Promise.resolve();
    expect(core.issued).toEqual(['load', 'configure']);
    expect(sentWhileDispatching).toEqual([false]);
  });

  it('does the same after an action that failed', async () => {
    const core = new FakeCore();
    const gate = new CommandGate(core);
    void gate.run('loadPublication', () => core.issued.push('load'));
    void gate.run('configure', () => core.issued.push('configure'));

    core.emit('error', {
      content: { messages: ['Error during action:', 'loadPublication'] },
    });
    expect(core.issued).toEqual(['load']);
    await Promise.resolve();
    expect(core.issued).toEqual(['load', 'configure']);
  });

  it('sends a command at once when nothing is with core', () => {
    const core = new FakeCore();
    const gate = new CommandGate(core);
    void gate.run('configure', () => core.issued.push('configure'));
    expect(core.issued).toEqual(['configure']);
  });

  it('is not released by the done event of another action', async () => {
    const core = new FakeCore();
    const gate = new CommandGate(core);
    void gate.run('configure', () => core.issued.push('configure'));
    void gate.run('moveTo', () => core.issued.push('move'));
    core.done('moveTo');
    await flush();
    expect(core.issued).toEqual(['configure']);
  });

  it('drops a queued command for a newer one with the same key', async () => {
    const core = new FakeCore();
    const gate = new CommandGate(core);
    void gate.run('moveTo', () => core.issued.push('move'));
    const stale = gate.run(
      'loadPublication',
      () => core.issued.push('load 1'),
      {
        key: 'load',
      },
    );
    const latest = gate.run(
      'loadPublication',
      () => core.issued.push('load 2'),
      { key: 'load' },
    );
    expect(await stale).toBe(false);

    core.done('moveTo');
    await flush();
    core.done('loadPublication');
    expect(await latest).toBe(true);
    expect(core.issued).toEqual(['move', 'load 2']);
  });

  it('keeps the command in flight when one with its key is queued', async () => {
    const core = new FakeCore();
    const gate = new CommandGate(core);
    const running = gate.run(
      'loadPublication',
      () => core.issued.push('load 1'),
      {
        key: 'load',
      },
    );
    void gate.run('loadPublication', () => core.issued.push('load 2'), {
      key: 'load',
    });
    core.done('loadPublication');
    expect(await running).toBe(true);
    expect(core.issued).toEqual(['load 1', 'load 2']);
  });

  it('moves on when core reports that the action failed', async () => {
    const core = new FakeCore();
    const gate = new CommandGate(core);
    const failing = gate.run('loadPublication', () => core.issued.push('load'));
    void gate.run('moveTo', () => core.issued.push('move'));

    core.emit('error', { content: { messages: ['unrelated'] } });
    expect(core.issued).toEqual(['load']);

    core.emit('error', {
      content: { messages: ['Error during action:', 'loadPublication'] },
    });
    expect(await failing).toBe(true);
    expect(core.issued).toEqual(['load', 'move']);
  });

  it('moves on when issuing a command throws', async () => {
    const core = new FakeCore();
    const gate = new CommandGate(core);
    const originalError = console.error;
    console.error = () => {};
    try {
      const broken = gate.run('configure', () => {
        throw new Error('boom');
      });
      void gate.run('moveTo', () => core.issued.push('move'));
      expect(await broken).toBe(false);
      expect(core.issued).toEqual(['move']);
    } finally {
      console.error = originalError;
    }
  });

  it('handles a done event that arrives while the command is being issued', async () => {
    const core = new FakeCore();
    const gate = new CommandGate(core);
    const sync = gate.run('configure', () => {
      core.issued.push('configure');
      core.done('configure');
    });
    const next = gate.run('moveTo', () => core.issued.push('move'));
    expect(await sync).toBe(true);
    expect(core.issued).toEqual(['configure', 'move']);
    core.done('moveTo');
    expect(await next).toBe(true);
  });
});
