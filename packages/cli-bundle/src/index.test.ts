import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'rolldown/parseAst';
import { describe, expect, it } from 'vitest';

// The cli-bundle output is a worker-only ESM that pulls in browser-targeted
// shims; happy-dom drops `XMLHttpRequest` for node-mocks-http and jsdom
// disagrees on TextEncoder/Uint8Array realms. Rather than booting the bundle,
// we verify it as a build artifact: it must exist, parse, and re-export every
// documented entry.

const distRoot = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../dist',
);
const bundlePath = path.join(distRoot, 'index.js');
const dtsPath = path.join(distRoot, 'index.d.ts');

const expectedExports = [
  'setupServer',
  'teardownServer',
  'serve',
  'setupTemplate',
  'buildEpub',
  'buildWebPub',
  'exportProjectZip',
  'fromJSON',
  'toJSON',
  'read',
  'write',
  'rm',
  'fromBinarySnapshot',
  'toBinarySnapshot',
  'printTree',
  'webSocketConnect',
] as const;

const readBundle = () => fs.readFileSync(bundlePath, 'utf8');

describe('cli-bundle build artifact', () => {
  it('emits dist/index.js with non-trivial size', () => {
    const stat = fs.statSync(bundlePath);
    expect(stat.size).toBeGreaterThan(5 * 1024 * 1024);
  });

  it('emits dist/index.d.ts', () => {
    expect(fs.existsSync(dtsPath)).toBe(true);
  });

  it('parses as valid JavaScript', () => {
    const program = parseAst(readBundle(), { lang: 'js' }, 'index.js');
    expect(program.type).toBe('Program');
    expect(program.body.length).toBeGreaterThan(0);
  });

  it('re-exports the expected public API', () => {
    const program = parseAst(readBundle(), { lang: 'js' }, 'index.js');
    const exported = new Set<string>();
    for (const stmt of program.body) {
      if (stmt.type === 'ExportNamedDeclaration') {
        for (const spec of stmt.specifiers ?? []) {
          const name =
            spec.exported.type === 'Identifier'
              ? spec.exported.name
              : spec.exported.value;
          if (typeof name === 'string') exported.add(name);
        }
      }
    }
    for (const name of expectedExports) {
      expect(exported.has(name), `missing export "${name}"`).toBe(true);
    }
  });

  it('emits the WebAssembly assets next to the bundle', () => {
    expect(
      fs.existsSync(path.join(distRoot, 'rolldown-binding.wasm32-wasi.wasm')),
    ).toBe(true);
  });

  it('emits the rolldown wasi worker entry', () => {
    expect(fs.existsSync(path.join(distRoot, 'rolldown-wasi-worker.js'))).toBe(
      true,
    );
  });

  it('emits the client chunks consumed by vite', () => {
    for (const file of [
      'vite-client.js',
      'custom-hmr.js',
      'viewer-adapter.js',
    ]) {
      expect(fs.existsSync(path.join(distRoot, 'client', file))).toBe(true);
    }
  });
});
