import { vol } from 'memfs';

vol.fromJSON(__volume__);

vol.fromNestedJSON({
  workdir: {
    'package.json': JSON.stringify({
      name: 'project',
    }),
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        useDefineForClassFields: true,
        module: 'ESNext',
        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        skipLibCheck: true,

        /* Bundler mode */
        moduleResolution: 'bundler',
        allowImportingTsExtensions: true,
        isolatedModules: true,
        moduleDetection: 'force',
        noEmit: true,

        /* Linting */
        strict: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noFallthroughCasesInSwitch: true,
        noUncheckedSideEffectImports: true,
      },
      include: ['src'],
    }),
    'index.html': /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <title></title>
  <meta charset="UTF-8">
</head>
<body>
  <script type="module" src="/src/test.ts"></script>
</body>
</html>
`,
    src: {
      'test.ts': /* ts */ `
import * as Comlink from "https://unpkg.com/comlink/dist/esm/comlink.mjs";
import {debug} from './debug.ts';

const el = document.createElement('h3');
el.textContent = 'debug: ' + debug;
document.body.appendChild(el);

const buildForm = document.createElement('form');
buildForm.setHTMLUnsafe('<button>build</button>');
buildForm.method = 'POST';
buildForm.action = '/api/build';
document.body.appendChild(buildForm);
buildForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const channel = new BroadcastChannel('vs-cli');
  const zip = await Comlink.wrap(channel).build();
  const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'project.zip';
  a.click();
});

const debugForm = document.createElement('form');
debugForm.setHTMLUnsafe('<button>debug</button>');
debugForm.method = 'POST';
debugForm.action = '/api/build';
document.body.appendChild(debugForm);
debugForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const channel = new BroadcastChannel('vs-cli');
  Comlink.wrap(channel).debug();
});
`,
      'debug.ts': 'export const debug = 1;',
    },
  },
});
