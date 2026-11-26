import { spawn } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import {
  CORPORA,
  type Corpus,
  generateProbe,
  groupOf,
  parseDuration,
} from './fuzz';
import {
  HARNESS_VERSION,
  listCommands,
  listNotations,
  minimizeProbe,
  ORACLES,
  type Oracle,
  type Probe,
  runProbe,
  toEditorCase,
  type Verdict,
} from './harness';

export const FINDING_SCHEMA = 'vivliostyle-pub/editor-finding@1';
export const REPORT_SCHEMA = 'vivliostyle-pub/editor-bug-report@1';

const SEVERITIES = [
  'data-loss',
  'corruption',
  'crash',
  'save-blocked',
  'security',
  'wrong-result',
  'minor',
];
const CATEGORIES = [
  'typing',
  'input-rule',
  'keymap',
  'command',
  'paste-rule',
  'selection',
  'undo',
  'parse',
  'serialize',
  'plugin',
  'notation-record',
  'html-element',
  'dom',
  'other',
];

export interface Finding {
  schema: typeof FINDING_SCHEMA;
  id: string;
  title: string;
  oracle: Oracle;
  severity: string;
  category: string;
  probe: Probe;
  expected: {
    markdown: string;
    rationale: string;
    evidence?: unknown[];
  };
  area?: { notations?: string[]; files?: string[] };
  knownLimitation?: { file: string; reason: string } | null;
  confidence: 'high' | 'medium' | 'low';
  hypothesis?: string;
  related?: string[];
  found?: Record<string, unknown>;
}

interface Flags {
  positional: string[];
  values: Map<string, string>;
  switches: Set<string>;
}

const VALUE_FLAGS = new Set([
  '--oracle',
  '--budget',
  '--out',
  '--timeout',
  '--duration',
  '--seed',
  '--per-group',
  '--corpus',
  '--steps',
  '--start',
  '--deadline',
  '--max',
]);

function parseFlags(argv: readonly string[]): Flags {
  const flags: Flags = {
    positional: [],
    values: new Map(),
    switches: new Set(),
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (VALUE_FLAGS.has(arg)) {
      flags.values.set(arg, argv[++index] ?? '');
    } else if (arg.startsWith('--')) {
      flags.switches.add(arg);
    } else {
      flags.positional.push(arg);
    }
  }
  return flags;
}

function readInput(path: string | undefined): string {
  return !path || path === '-'
    ? readFileSync(0, 'utf8')
    : readFileSync(path, 'utf8');
}

/** A probe, an array of probes, or one probe per line. */
export function parseProbes(text: string): unknown[] {
  const trimmed = text.trim();
  if (trimmed === '') {
    return [];
  }
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return trimmed
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line));
  }
}

function output(value: unknown, flags: Flags): void {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const out = flags.values.get('--out');
  if (out) {
    writeFileSync(out, text);
  } else {
    process.stdout.write(text);
  }
}

function compact(verdict: Verdict) {
  return {
    id: verdict.id,
    status: verdict.status,
    oracles: verdict.oracles,
    error: verdict.error,
    violations: verdict.violations.map(({ oracle, step, detail }) => ({
      oracle,
      step,
      detail,
    })),
    signals: verdict.signals.map(({ oracle, detail }) => ({ oracle, detail })),
    saved: verdict.saved,
    fingerprint: verdict.fingerprint,
  };
}

function withOptions(probe: unknown, flags: Flags): unknown {
  if (!flags.switches.has('--properties') || typeof probe !== 'object') {
    return probe;
  }
  const value = probe as Probe;
  return { ...value, options: { ...value.options, properties: true } };
}

async function run(flags: Flags): Promise<number> {
  const probes = parseProbes(readInput(flags.positional[0]));
  const verdicts: unknown[] = [];
  for (const probe of probes) {
    const verdict = await runProbe(withOptions(probe, flags));
    verdicts.push(flags.switches.has('--full') ? verdict : compact(verdict));
  }
  output(verdicts, flags);
  return 0;
}

function asOracle(value: string | undefined): Oracle | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!ORACLES.includes(value as Oracle)) {
    throw new Error(`Unknown oracle ${value}; one of ${ORACLES.join(', ')}`);
  }
  return value as Oracle;
}

async function minimize(flags: Flags): Promise<number> {
  const [input] = parseProbes(readInput(flags.positional[0]));
  const finding = isFinding(input) ? input : undefined;
  const probe = (finding ? finding.probe : input) as Probe;
  const oracle = asOracle(flags.values.get('--oracle')) ?? finding?.oracle;
  if (oracle === 'expectation' || (!oracle && probe.expect !== undefined)) {
    // Shrinking the input would need the expected markdown to shrink with it.
    throw new Error(
      'An expectation cannot be shrunk automatically: name an automatic oracle with --oracle, or shrink it by hand',
    );
  }
  const budget = Number(flags.values.get('--budget') ?? 400);
  const result = await minimizeProbe(probe, { oracle, budget });
  output(
    {
      probe: result.probe,
      runs: result.runs,
      verdict: compact(result.verdict),
    },
    flags,
  );
  return 0;
}

function isFinding(value: unknown): value is Finding {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { schema?: unknown }).schema === FINDING_SCHEMA
  );
}

/** What is wrong with a finding's shape, without running it. */
export function findingProblems(value: unknown): string[] {
  const problems: string[] = [];
  if (!isFinding(value)) {
    return [`\`schema\` must be "${FINDING_SCHEMA}"`];
  }
  const need = (ok: unknown, message: string) => {
    if (!ok) {
      problems.push(message);
    }
  };
  need(
    typeof value.id === 'string' && value.id !== '',
    '`id` is a non-empty string',
  );
  need(
    typeof value.title === 'string' && value.title !== '',
    '`title` is a non-empty string',
  );
  need(ORACLES.includes(value.oracle), `\`oracle\` is one of ${ORACLES}`);
  need(
    SEVERITIES.includes(value.severity),
    `\`severity\` is one of ${SEVERITIES}`,
  );
  need(
    CATEGORIES.includes(value.category),
    `\`category\` is one of ${CATEGORIES}`,
  );
  need(
    ['high', 'medium', 'low'].includes(value.confidence),
    '`confidence` is high, medium or low',
  );
  need(typeof value.probe?.given === 'string', '`probe.given` is markdown');
  need(
    value.probe?.expect === undefined,
    '`probe.expect` is left out: the expectation is `expected.markdown`',
  );
  need(
    typeof value.expected?.markdown === 'string',
    '`expected.markdown` is the markdown the save should be',
  );
  need(
    typeof value.expected?.rationale === 'string' &&
      value.expected.rationale.length > 0,
    '`expected.rationale` says why, with VFM evidence where it is about meaning',
  );
  if (value.oracle === 'hang') {
    problems.push(
      '`hang` cannot be replayed in process: shrink it with `run --timeout` and report the probe in an issue by hand',
    );
  }
  return problems;
}

function findingFiles(paths: readonly string[]): string[] {
  const files: string[] = [];
  for (const path of paths) {
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path).sort()) {
        if (entry.endsWith('.json')) {
          files.push(join(path, entry));
        }
      }
    } else {
      files.push(path);
    }
  }
  return files;
}

async function verify(flags: Flags): Promise<number> {
  const files = findingFiles(
    flags.positional.length > 0 ? flags.positional : ['bug-hunt/work/findings'],
  );
  const entries = [];
  const byFingerprint = new Map<string, string>();
  let failed = 0;
  for (const file of files) {
    const name = relative(process.cwd(), resolve(file));
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      entries.push({ file: name, valid: false, problems: [String(error)] });
      failed++;
      continue;
    }
    const problems = findingProblems(value);
    if (problems.length > 0) {
      entries.push({
        file: name,
        id: (value as { id?: string }).id,
        valid: false,
        problems,
      });
      failed++;
      continue;
    }
    const finding = value as Finding;
    const verdict = await runProbe({
      ...finding.probe,
      expect: finding.expected.markdown,
    });
    const reproduced = verdict.oracles.includes(finding.oracle);
    const fingerprint = verdict.fingerprint;
    const duplicateOf = byFingerprint.get(fingerprint) ?? null;
    if (!duplicateOf) {
      byFingerprint.set(fingerprint, finding.id);
    }
    if (!reproduced && verdict.status !== 'clean') {
      failed++;
    }
    entries.push({
      file: name,
      id: finding.id,
      valid: true,
      title: finding.title,
      oracle: finding.oracle,
      severity: finding.severity,
      category: finding.category,
      confidence: finding.confidence,
      knownLimitation: finding.knownLimitation ?? null,
      // `fixed` once the claimed oracle no longer fires and nothing else does.
      state: reproduced
        ? 'reproduced'
        : verdict.status === 'clean'
          ? 'fixed'
          : 'changed',
      oracles: verdict.oracles,
      status: verdict.status,
      error: verdict.error,
      fingerprint,
      duplicateOf,
      saved: verdict.saved,
    });
  }
  output(
    {
      schema: REPORT_SCHEMA,
      harnessVersion: HARNESS_VERSION,
      generatedAt: new Date().toISOString(),
      findings: entries,
    },
    flags,
  );
  return flags.switches.has('--expect-reproduced') && failed > 0 ? 1 : 0;
}

function toCase(flags: Flags): number {
  const value = JSON.parse(readInput(flags.positional[0]));
  const problems = findingProblems(value);
  if (problems.length > 0) {
    throw new Error(problems.join('\n'));
  }
  const finding = value as Finding;
  process.stdout.write(
    `${toEditorCase(
      finding.title,
      finding.probe,
      finding.expected.markdown,
      finding.hypothesis ?? finding.title,
    )}\n`,
  );
  return 0;
}

function numberFlag(flags: Flags, name: string, fallback: number): number {
  const value = flags.values.get(name);
  if (value === undefined) {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${name} takes a number, not ${JSON.stringify(value)}`);
  }
  return number;
}

function corpusFlag(flags: Flags): Corpus {
  const corpus = flags.values.get('--corpus') ?? 'all';
  if (!CORPORA.includes(corpus as Corpus)) {
    throw new Error(`--corpus is one of ${CORPORA.join(', ')}`);
  }
  return corpus as Corpus;
}

/** Runs generated probes until the deadline, one JSON line per event. */
async function fuzzWorker(flags: Flags): Promise<number> {
  const options = {
    seed: numberFlag(flags, '--seed', 1),
    corpus: corpusFlag(flags),
    steps: numberFlag(flags, '--steps', 4),
    properties: flags.switches.has('--properties'),
  };
  const deadline = numberFlag(flags, '--deadline', Date.now() + 60_000);
  const max = numberFlag(flags, '--max', Number.POSITIVE_INFINITY);
  for (
    let index = numberFlag(flags, '--start', 0);
    index < max && Date.now() < deadline;
    index++
  ) {
    // Written before the probe runs, so a probe that never returns is known.
    // A caret mark in the middle of syntax changes how it parses, which
    // says nothing about the editor: put it somewhere else.
    const attempt = async (probe: Probe) => {
      process.stdout.write(
        `${JSON.stringify({ type: 'start', index, probe })}\n`,
      );
      return runProbe(probe);
    };
    let probe = generateProbe(index, options);
    let verdict = await attempt(probe);
    for (
      let retry = 1;
      retry < 8 &&
      verdict.status === 'invalid-probe' &&
      verdict.error?.includes('‸');
      retry++
    ) {
      probe = generateProbe(index, options, retry);
      verdict = await attempt(probe);
    }
    process.stdout.write(
      `${JSON.stringify({ type: 'result', index, probe, verdict })}\n`,
    );
  }
  return 0;
}

interface FuzzEvent {
  type: 'start' | 'result';
  index: number;
  probe?: Probe;
  verdict?: Verdict;
}

/**
 * Fuzzes for a while in a child process, restarting it past any probe that
 * outlives the timeout, and appends each new kind of violation to a JSONL
 * file: the probe, its verdict and, with `--minimize`, a shrunk probe.
 */
async function fuzz(flags: Flags): Promise<number> {
  const seed = numberFlag(flags, '--seed', Date.now() % 1_000_000_000);
  const corpus = corpusFlag(flags);
  const steps = numberFlag(flags, '--steps', 4);
  const properties = flags.switches.has('--properties');
  const timeout = numberFlag(flags, '--timeout', 20_000);
  const perGroup = numberFlag(flags, '--per-group', 3);
  const max = numberFlag(flags, '--max', Number.POSITIVE_INFINITY);
  const deadline =
    Date.now() + parseDuration(flags.values.get('--duration') ?? '10m');
  const out = flags.values.get('--out') ?? `bug-hunt/work/fuzz-${seed}.jsonl`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, '');
  const bin = fileURLToPath(new URL('./bin.mjs', import.meta.url));

  const statuses = new Map<string, number>();
  const groups = new Map<string, number>();
  let probes = 0;
  const startedAt = Date.now();
  const options = { seed, corpus, steps, properties };

  const kept: Record<string, unknown>[] = [];
  const record = (index: number, probe: Probe, verdict: Verdict) => {
    probes++;
    statuses.set(verdict.status, (statuses.get(verdict.status) ?? 0) + 1);
    if (verdict.status !== 'violations') {
      return;
    }
    const group = groupOf(verdict);
    const seen = groups.get(group) ?? 0;
    groups.set(group, seen + 1);
    if (seen >= perGroup) {
      return;
    }
    const entry: Record<string, unknown> = { group, probe, verdict };
    kept.push(entry);
    appendFileSync(out, `${JSON.stringify(entry)}\n`);
    process.stderr.write(`[${new Date().toISOString()}] #${index} ${group}\n`);
  };

  let start = 0;
  while (Date.now() < deadline && start < max) {
    const child = spawn(
      process.execPath,
      [
        bin,
        'fuzz-worker',
        '--seed',
        String(seed),
        '--start',
        String(start),
        '--deadline',
        String(deadline),
        '--corpus',
        corpus,
        '--steps',
        String(steps),
        ...(Number.isFinite(max) ? ['--max', String(max)] : []),
        ...(properties ? ['--properties'] : []),
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    let current = -1;
    let running: Probe | undefined;
    let since = Date.now();
    let hung = false;
    const watchdog = setInterval(() => {
      if (current !== -1 && Date.now() - since > timeout) {
        hung = true;
        child.kill('SIGKILL');
      }
    }, 500);
    for await (const line of createInterface({ input: child.stdout })) {
      let event: FuzzEvent;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type === 'start') {
        current = event.index;
        running = event.probe;
        since = Date.now();
      } else if (event.verdict) {
        current = -1;
        start = event.index + 1;
        record(
          event.index,
          event.probe ?? generateProbe(event.index, options),
          event.verdict,
        );
      }
    }
    const code: number | null = await new Promise((done) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        done(child.exitCode);
      } else {
        child.on('exit', (exit) => done(exit));
      }
    });
    clearInterval(watchdog);
    if (current !== -1) {
      const probe = running ?? generateProbe(current, options);
      const oracle = hung ? 'hang' : 'step-threw';
      const detail = hung
        ? `did not finish within ${timeout} ms`
        : `the worker exited with ${code} while running it`;
      record(current, probe, {
        id: probe.id ?? null,
        status: 'violations',
        violations: [{ oracle, step: -1, detail }],
        signals: [],
        saved: null,
        savedWithSelection: null,
        doc: null,
        strategy: null,
        html: { editor: null, vfm: null },
        trace: [],
        oracles: [oracle],
        fingerprint: '',
        harnessVersion: HARNESS_VERSION,
      });
      start = current + 1;
    } else if (code !== 0) {
      throw new Error(`The fuzz worker exited with ${code}`);
    }
  }

  // After the run, so that shrinking never holds up the watchdog. The file
  // already holds every entry in case the run is stopped before this.
  if (flags.switches.has('--minimize')) {
    for (const entry of kept) {
      const verdict = entry.verdict as Verdict;
      const oracle = verdict.oracles.find(
        (it) => it !== 'expectation' && it !== 'hang',
      );
      if (oracle) {
        const { expect: _, ...probe } = entry.probe as Probe;
        entry.minimized = (
          await minimizeProbe(probe, { oracle, budget: 150 })
        ).probe;
      }
    }
    writeFileSync(
      out,
      kept.map((entry) => `${JSON.stringify(entry)}\n`).join(''),
    );
  }

  const summary = {
    seed,
    corpus,
    steps,
    properties,
    durationMs: Date.now() - startedAt,
    probes,
    next: start,
    statuses: Object.fromEntries(statuses),
    groups: Object.fromEntries([...groups].sort((a, b) => b[1] - a[1])),
    out,
  };
  writeFileSync(
    `${out.replace(/\.jsonl$/, '')}.summary.json`,
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return 0;
}

const USAGE = `Usage: pnpm bug-hunt <command> [args]

  run [file|-] [--full] [--properties] [--out file] [--timeout ms]
      Runs probes (a JSON probe, an array, or JSONL) and prints verdicts.
  minimize [file|-] [--oracle name] [--budget n] [--out file]
      Shrinks a probe or finding while the oracle still fires.
  verify [dir|files...] [--out file] [--expect-reproduced]
      Replays findings (default bug-hunt/work/findings) into a report.
  case [file|-]
      Prints a finding as an editor behaviour case for tests/cases/.
  fuzz [--duration 10m] [--seed n] [--corpus all|markdown|vfm|html]
       [--steps n] [--timeout ms] [--per-group n] [--minimize] [--properties]
       [--max n] [--out file.jsonl]
      Runs generated probes for a while and appends each new kind of
      violation to a JSONL file (bug-hunt/work/fuzz-<seed>.jsonl).
  commands | notations | oracles
      Lists what probes can name.
`;

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  const flags = parseFlags(rest);
  switch (command) {
    case 'run':
      return run(flags);
    case 'minimize':
      return minimize(flags);
    case 'verify':
      return verify(flags);
    case 'case':
      return toCase(flags);
    case 'commands':
      output(listCommands(), flags);
      return 0;
    case 'notations':
      output(listNotations(), flags);
      return 0;
    case 'oracles':
      output(ORACLES, flags);
      return 0;
    case 'fuzz':
      return fuzz(flags);
    case 'fuzz-worker':
      return fuzzWorker(flags);
    default:
      process.stderr.write(USAGE);
      return command ? 2 : 0;
  }
}
