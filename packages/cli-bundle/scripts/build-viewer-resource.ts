import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const viewerRoot = path.join(
  require.resolve('@vivliostyle/viewer/package.json'),
  '..',
);

const headStartTagRe = /<head[^>]*>/i;
export const prependToHead = (html: string, content: string) =>
  html.replace(headStartTagRe, (match) => `${match}\n${content}`);

const html = prependToHead(
  fs.readFileSync(path.join(viewerRoot, 'lib/index.html'), 'utf-8'),
  `<script type="module">
    const cliWorker = new Worker('/@worker/cli.js');
    const channel = new MessageChannel();
    navigator.serviceWorker.controller?.postMessage({ command: 'connect' }, [channel.port2]);
    cliWorker.postMessage({ command: 'connect' }, [channel.port1]);
  </script>
  <script type="module" src="/@vivliostyle:viewer:client"></script>`,
);
fs.mkdirSync(path.join(fileURLToPath(import.meta.url), '../../dist/viewer'), {
  recursive: true,
});
fs.writeFileSync(
  path.join(fileURLToPath(import.meta.url), '../../dist/viewer/index.html'),
  html,
);

for (const file of ['css', 'fonts', 'js', 'resources'].flatMap((dir) =>
  fs
    .readdirSync(path.join(viewerRoot, 'lib', dir))
    .map((file) => path.join(dir, file)),
)) {
  const dest = path.join(
    fileURLToPath(import.meta.url),
    '../../dist/viewer',
    file,
  );
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(path.join(viewerRoot, 'lib', file)), dest);
}
