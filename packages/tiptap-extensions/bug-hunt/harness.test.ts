import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { findingProblems, parseProbes } from './cli';
import { minimizeProbe, runProbe, toEditorCase, unsafeMarkup } from './harness';

const example = JSON.parse(
  readFileSync(new URL('./examples/finding.json', import.meta.url), 'utf8'),
);

describe('runProbe', () => {
  it('passes a probe the editor handles', async () => {
    const verdict = await runProbe({
      given: 'ab‸cd',
      steps: ['X', { kind: 'press', key: 'Enter' }],
      expect: 'abX\n\n‸cd',
    });
    expect(verdict.status).toBe('clean');
    expect(verdict.saved).toBe('abX\n\ncd');
  });

  it('reports a different save as an expectation', async () => {
    const verdict = await runProbe({
      given: 'a‸',
      steps: ['b'],
      expect: 'ac',
    });
    expect(verdict.oracles).toEqual(['expectation']);
  });

  it('tells a mistake in the probe from a bug', async () => {
    const unknown = await runProbe({
      given: '‸',
      steps: [{ kind: 'command', name: 'noSuchCommand' }],
    });
    expect(unknown.status).toBe('invalid-probe');
    const outside = await runProbe({
      given: 'a',
      steps: [{ kind: 'select', anchor: 99 }],
    });
    expect(outside.status).toBe('invalid-probe');
    expect((await runProbe({ steps: [] })).status).toBe('invalid-probe');
  });

  it('skips what the headless driver cannot do', async () => {
    const verdict = await runProbe({
      given: 'a‸',
      steps: [{ kind: 'press', key: 'ArrowLeft' }],
    });
    expect(verdict.status).toBe('unsupported');
  });

  it('saves, reloads and keeps the file as the baseline', async () => {
    const verdict = await runProbe({
      given: '# t\n\nx‸\n',
      steps: ['y', { kind: 'save' }, { kind: 'reload' }],
    });
    expect(verdict.status).toBe('clean');
    expect(verdict.trace[1]?.saved).toBe('# t\n\nxy\n');
    expect(verdict.saved).toBe('# t\n\nxy\n');
  });

  it('checks a command’s result when the probe says what it is', async () => {
    const verdict = await runProbe({
      given: 'a',
      steps: [
        {
          kind: 'command',
          name: 'liftListItem',
          args: ['listItem'],
          returns: true,
        },
      ],
    });
    expect(verdict.oracles).toEqual(['expectation']);
  });

  it('pastes text through paste rules and content as nodes', async () => {
    const text = await runProbe({
      given: 'a‸',
      steps: [{ kind: 'pasteText', text: ' b' }],
    });
    expect(text.saved).toBe('a b');
    const content = await runProbe({
      given: 'a‸b',
      steps: [
        {
          kind: 'pasteContent',
          content: [{ type: 'text', text: 'X', marks: [{ type: 'bold' }] }],
        },
      ],
    });
    expect(content.saved).toBe('a**X**b');
  });

  it('cannot undo loading the file', async () => {
    const verdict = await runProbe({
      given: 'a‸',
      options: { history: true },
      steps: ['bc', { kind: 'command', name: 'undo' }],
      expect: 'a‸',
    });
    expect(verdict.status).toBe('clean');
  });

  it('replays the example finding', async () => {
    expect(findingProblems(example)).toEqual([]);
    const verdict = await runProbe({
      ...example.probe,
      expect: example.expected.markdown,
    });
    expect(verdict.oracles).toContain(example.oracle);
  });
});

describe('unsafeMarkup', () => {
  it('finds markup that runs script', () => {
    expect(
      unsafeMarkup(
        '<p><a href=" java\tscript:x">a</a><img src="i" onerror="x"><script></script></p>',
      ),
    ).toEqual([
      'href=" java\\tscript:x" on <a>',
      'onerror attribute on <img>',
      '<script> element',
    ]);
    expect(unsafeMarkup('<p><a href="https://x.jp">a</a></p>')).toEqual([]);
  });
});

describe('minimizeProbe', () => {
  it('keeps the oracle while dropping what does not matter', async () => {
    const { probe, verdict } = await minimizeProbe(
      {
        given: 'a‸',
        steps: [
          'b',
          'c',
          {
            kind: 'command',
            name: 'liftListItem',
            args: ['listItem'],
            returns: true,
          },
        ],
      },
      { oracle: 'expectation' },
    );
    expect(verdict.oracles).toContain('expectation');
    expect(probe.steps).toEqual([
      {
        kind: 'command',
        name: 'liftListItem',
        args: ['listItem'],
        returns: true,
      },
    ]);
    expect(probe.given).toBe('‸');
  });
});

describe('parseProbes', () => {
  it('reads a probe, an array or JSON lines', () => {
    expect(parseProbes('{"given":"a"}')).toEqual([{ given: 'a' }]);
    expect(parseProbes('[{"given":"a"}]')).toEqual([{ given: 'a' }]);
    expect(parseProbes('{"given":"a"}\n{"given":"b"}\n')).toEqual([
      { given: 'a' },
      { given: 'b' },
    ]);
  });
});

describe('toEditorCase', () => {
  it('writes a failing case for tests/cases/', () => {
    expect(
      toEditorCase(
        'it',
        { given: 'a‸', steps: ['b', { kind: 'press', key: 'Enter' }] },
        'ab\n\n‸',
        'why',
      ),
    ).toBe(
      "{\n  name: 'it',\n  given: 'a‸',\n  steps: ['b', press('Enter')],\n  expect: 'ab\\n\\n‸',\n  fails: 'why',\n},",
    );
  });
});
