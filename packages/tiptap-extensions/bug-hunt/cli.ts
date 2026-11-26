import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

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

const VALUE_FLAGS = new Set(['--oracle', '--budget', '--out', '--timeout']);

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

const USAGE = `Usage: pnpm bug-hunt <command> [args]

  run [file|-] [--full] [--properties] [--out file] [--timeout ms]
      Runs probes (a JSON probe, an array, or JSONL) and prints verdicts.
  minimize [file|-] [--oracle name] [--budget n] [--out file]
      Shrinks a probe or finding while the oracle still fires.
  verify [dir|files...] [--out file] [--expect-reproduced]
      Replays findings (default bug-hunt/work/findings) into a report.
  case [file|-]
      Prints a finding as an editor behaviour case for tests/cases/.
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
    default:
      process.stderr.write(USAGE);
      return command ? 2 : 0;
  }
}
