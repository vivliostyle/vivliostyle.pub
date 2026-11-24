import { EditorState } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';

import { PubExtensions } from '../index';
import { type EditorCase, failureReason, runCase } from './case';
import { createNodeDriver } from './node-driver';
import { run } from './steps';
import { assertOutcome } from './vitest';

async function runOnNode(testCase: Omit<EditorCase, 'name'>) {
  const driver = createNodeDriver([PubExtensions.configure({})]);
  try {
    return await runCase(driver, { name: 'case', ...testCase });
  } finally {
    driver.destroy();
  }
}

async function labelsOf(testCase: Omit<EditorCase, 'name'>) {
  return (await runOnNode(testCase)).map(({ label }) => label);
}

describe('runCase', () => {
  it('returns nothing for a case the editor passes', async () => {
    expect(
      await runOnNode({ given: 'ab‸', steps: ['c'], expect: 'abc‸' }),
    ).toEqual([]);
  });

  it('returns what differs', async () => {
    expect(
      await runOnNode({ given: 'ab‸', steps: ['c'], expect: 'abX‸' }),
    ).toEqual([
      {
        label: 'markdown with the selection',
        actual: 'abc‸',
        expected: 'abX‸',
      },
      { label: 'markdown', actual: 'abc', expected: 'abX' },
    ]);
  });

  it('tells a wrong selection apart from wrong markdown', async () => {
    expect(
      await labelsOf({ given: 'ab‸', steps: ['c'], expect: 'ab‸c' }),
    ).toEqual(['markdown with the selection']);
  });

  it('returns an invalid document as a mismatch', async () => {
    const [mismatch] = await runOnNode({
      given: 'a‸',
      steps: [
        run('put text straight into the document', (editor) => {
          const { schema } = editor.state;
          const doc = schema.topNodeType.create(null, schema.text('a'));
          editor.view.updateState(
            EditorState.create({ doc, plugins: editor.state.plugins }),
          );
        }),
      ],
      expect: 'a',
    });
    expect(mismatch).toMatchObject({ label: 'the document' });
    expect(mismatch && 'error' in mismatch && mismatch.error).toBeInstanceOf(
      RangeError,
    );
  });

  it('matches `json` as a subset of each node, but not of a list', async () => {
    const heading = { type: 'heading', attrs: { level: 1 } };
    expect(await runOnNode({ given: '# a', json: [heading] })).toEqual([]);
    expect(await labelsOf({ given: '# a\n\nb', json: [heading] })).toEqual([
      'json',
    ]);
    expect(
      await labelsOf({
        given: '# a',
        json: [{ ...heading, attrs: { level: 1, id: 'x' } }],
      }),
    ).toEqual(['json']);
  });

  it('throws when a case has steps but no `expect`', async () => {
    await expect(runOnNode({ given: 'a‸', steps: ['b'] })).rejects.toThrow(
      'has steps but no `expect`',
    );
  });

  it('throws when a step cannot be performed', async () => {
    await expect(
      runOnNode({
        given: 'a‸',
        steps: [
          run('break', () => {
            throw new Error('broken');
          }),
        ],
        expect: 'a‸',
      }),
    ).rejects.toThrow('Could not break');
  });

  it('throws for more than two marks', async () => {
    await expect(runOnNode({ given: 'a‸b‸c‸' })).rejects.toThrow('at most two');
  });

  it('throws when a mark is not in the text', async () => {
    await expect(
      runOnNode({ given: '[a](https://example.com/‸) b‸' }),
    ).rejects.toThrow('has 2 ‸ marks, but 1 in');
  });

  it('throws when the steps have no mark to start at', async () => {
    await expect(
      runOnNode({ given: 'a', steps: ['b'], expect: 'ab' }),
    ).rejects.toThrow('no ‸ mark');
  });

  it('throws when the marks change the parse', async () => {
    await expect(runOnNode({ given: '**太字‸**です' })).rejects.toThrow(
      'change how `given` is parsed',
    );
    await expect(runOnNode({ given: 'foo‸_bar_' })).rejects.toThrow(
      'change how `given` is parsed',
    );
    expect(await runOnNode({ given: '‸**太字**です' })).toEqual([]);
  });

  it('throws for a selection the marks cannot write', async () => {
    await expect(
      runOnNode({
        given: 'a‸',
        steps: [run('select all', (editor) => editor.commands.selectAll())],
        expect: '‸a‸',
      }),
    ).rejects.toThrow('only stand for a text selection');
  });
});

describe('failureReason', () => {
  const testCase: EditorCase = {
    name: 'case',
    given: '',
    fails: { browser: 'in every browser', webkit: 'in WebKit' },
  };

  it('prefers the engine over the driver', () => {
    expect(failureReason(testCase, { name: 'browser', engine: 'webkit' })).toBe(
      'in WebKit',
    );
    expect(
      failureReason(testCase, { name: 'browser', engine: 'chromium' }),
    ).toBe('in every browser');
    expect(failureReason(testCase, { name: 'node' })).toBeUndefined();
  });
});

describe('assertOutcome', () => {
  it('requires a case with a reason to fail', () => {
    expect(() => assertOutcome([], 'not yet')).toThrow(
      'remove its `fails` reason',
    );
    expect(() =>
      assertOutcome([{ label: 'markdown', actual: 'a', expected: 'b' }], 'x'),
    ).not.toThrow();
  });
});
