import { describe, expect, it } from 'vitest';

import { generateProbe, groupOf, parseDuration } from './fuzz';
import { runProbe } from './harness';

const options = { seed: 7, corpus: 'all', steps: 4 } as const;

describe('generateProbe', () => {
  it('makes the same probe again from the seed and the index', () => {
    expect(generateProbe(12, options)).toEqual(generateProbe(12, options));
    expect(generateProbe(12, options)).not.toEqual(generateProbe(13, options));
    expect(generateProbe(12, options, 1).id).toBe('fuzz-7-12.1');
  });

  it('makes probes the harness can run', async () => {
    const statuses = new Set<string>();
    for (let index = 0; index < 30; index++) {
      statuses.add((await runProbe(generateProbe(index, options))).status);
    }
    expect(statuses).toContain('clean');
  });
});

describe('groupOf', () => {
  it('leaves out what varies between probes', () => {
    const verdict = (detail: string) =>
      ({
        oracles: ['save-refused'],
        violations: [{ oracle: 'save-refused', step: 2, detail }],
      }) as unknown as Parameters<typeof groupOf>[0];
    expect(groupOf(verdict('block 3 of "a"'))).toBe(
      groupOf(verdict('block 12 of "b"')),
    );
  });
});

describe('parseDuration', () => {
  it('reads units', () => {
    expect(parseDuration('90s')).toBe(90_000);
    expect(parseDuration('30m')).toBe(1_800_000);
    expect(parseDuration('1.5h')).toBe(5_400_000);
    expect(parseDuration('250')).toBe(250);
    expect(() => parseDuration('soon')).toThrow();
  });
});
