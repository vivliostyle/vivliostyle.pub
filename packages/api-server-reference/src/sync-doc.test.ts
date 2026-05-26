import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { SqliteStore } from './store';
import { DocRegistry } from './sync-doc';

describe('DocRegistry', () => {
  it('notifies subscribers when another connection applies an update', () => {
    // Two WebSocket-like origins subscribe to the same (project, file) doc.
    // An update applied with origin=A must reach subscriber B but not A,
    // mirroring how the WS route filters echoes back to the sender.
    const docs = new DocRegistry(new SqliteStore());
    const received: Array<{ at: 'A' | 'B'; bytes: number }> = [];
    const wsA = Symbol('wsA');
    const wsB = Symbol('wsB');
    docs.subscribe('p1', 'chapter.md', (update, origin) => {
      if (origin !== wsA) received.push({ at: 'A', bytes: update.byteLength });
    });
    docs.subscribe('p1', 'chapter.md', (update, origin) => {
      if (origin !== wsB) received.push({ at: 'B', bytes: update.byteLength });
    });

    const editor = new Y.Doc();
    editor.getText('t').insert(0, 'hello');
    docs.applyUpdate('p1', 'chapter.md', Y.encodeStateAsUpdate(editor), wsA);

    expect(received.map((r) => r.at)).toEqual(['B']);
    expect(received[0].bytes).toBeGreaterThan(0);
  });

  it('keeps the doc.on("update") listener live across subscriber turnover', () => {
    // Subscribers come and go as tabs connect/disconnect. A late subscriber
    // must still receive updates triggered after it subscribes, even if all
    // prior subscribers have unsubscribed (which empties the Set in the map).
    const docs = new DocRegistry(new SqliteStore());
    const wsA = Symbol('wsA');

    const unsubscribeA = docs.subscribe('p1', 'chapter.md', () => {});
    unsubscribeA();

    const seen: Uint8Array[] = [];
    docs.subscribe('p1', 'chapter.md', (update) => {
      seen.push(update);
    });

    const editor = new Y.Doc();
    editor.getText('t').insert(0, 'late join');
    docs.applyUpdate('p1', 'chapter.md', Y.encodeStateAsUpdate(editor), wsA);

    expect(seen).toHaveLength(1);
  });
});
