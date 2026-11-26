#!/usr/bin/env node
// Runs the TypeScript harness through Vite's module runner, so it needs no
// build step and resolves modules the way the tests do.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const argv = process.argv.slice(2);
const timeoutAt = argv.indexOf('--timeout');

// A probe that never returns cannot be stopped in process, so each one runs
// in a child that is killed when its time is up.
if (argv[0] === 'run' && timeoutAt !== -1) {
  const timeout = Number(argv[timeoutAt + 1]);
  const rest = argv.filter((_, at) => at !== timeoutAt && at !== timeoutAt + 1);
  const outAt = rest.indexOf('--out');
  const out = outAt === -1 ? undefined : rest[outAt + 1];
  const passed = rest.filter(
    (_, at) => outAt === -1 || (at !== outAt && at !== outAt + 1),
  );
  const file = passed.slice(1).find((it) => !it.startsWith('--'));
  const { module } = await runnerImport(
    fileURLToPath(new URL('./cli.ts', import.meta.url)),
    { configFile: false, logLevel: 'error' },
  );
  const text = readFileSync(!file || file === '-' ? 0 : file, 'utf8');
  const flags = passed.filter((it) => it.startsWith('--'));
  const verdicts = [];
  for (const probe of module.parseProbes(text)) {
    const child = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), 'run', '-', ...flags],
      { input: JSON.stringify(probe), timeout, encoding: 'utf8' },
    );
    if (child.error?.code === 'ETIMEDOUT' || child.signal) {
      verdicts.push({
        id: probe?.id ?? null,
        status: 'violations',
        oracles: ['hang'],
        violations: [
          {
            oracle: 'hang',
            step: -1,
            detail: `did not finish within ${timeout} ms`,
          },
        ],
      });
    } else if (child.status !== 0) {
      verdicts.push({
        id: probe?.id ?? null,
        status: 'invalid-probe',
        error: child.stderr.trim().split('\n').slice(-5).join('\n'),
      });
    } else {
      verdicts.push(...JSON.parse(child.stdout));
    }
  }
  const json = `${JSON.stringify(verdicts, null, 2)}\n`;
  if (out) {
    writeFileSync(out, json);
  } else {
    process.stdout.write(json);
  }
  process.exit(0);
}

const { module } = await runnerImport(
  fileURLToPath(new URL('./cli.ts', import.meta.url)),
  { configFile: false, logLevel: 'error' },
);
process.exitCode = await module.main(argv);
