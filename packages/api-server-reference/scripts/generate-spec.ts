import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app';
import { generateSpec } from '../src/openapi';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '../../api-spec/src/openapi.json');

const { app } = createApp();
const spec = await generateSpec(app);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(spec, null, 2)}\n`);
console.log(`Wrote OpenAPI spec to ${outPath}`);
