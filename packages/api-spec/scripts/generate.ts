import { readdirSync, statSync, watchFile, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';

const outPath = fileURLToPath(new URL('../src/openapi.yaml', import.meta.url));
const sourceDir = fileURLToPath(
  new URL('../../api-server-reference/src', import.meta.url),
);

const watchMode =
  process.argv.includes('--watch') || process.argv.includes('-w');

let pending = false;
let running = false;

async function generate() {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  try {
    console.log('[api-spec] regenerating src/openapi.yaml');
    // Bust ESM caches so changes to the reference implementation are picked
    // up on every re-run. Appending a unique query string forces re-import.
    const mod = await import(`@v/api-server-reference?ts=${Date.now()}`);
    const { app } = mod.createApp();
    const spec = await mod.generateSpec(app);
    writeFileSync(outPath, stringify(spec));
    console.log(`[api-spec] wrote ${outPath}`);
  } catch (err) {
    if (!watchMode) throw err;
    console.error('[api-spec] failed to regenerate spec:', err);
  } finally {
    running = false;
    if (pending) {
      pending = false;
      generate();
    }
  }
}

await generate();

if (!watchMode) {
  process.exit(0);
}

let debounce: NodeJS.Timeout | undefined;
const onChange = () => {
  clearTimeout(debounce);
  debounce = setTimeout(generate, 100);
};

// `fs.watch` on macOS uses FSEvents and intermittently raises EMFILE under
// recursive mode, so fall back to polling each `.ts` file under the source
// directory. Polling is cheap (a handful of files at 200ms) and stable.
function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    const stat = statSync(p);
    if (stat.isDirectory()) {
      collectFiles(p, out);
    } else if (p.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

const files = collectFiles(sourceDir);
for (const file of files) {
  watchFile(file, { interval: 200 }, onChange);
}
console.log(`[api-spec] watching ${files.length} file(s) under ${sourceDir}`);
